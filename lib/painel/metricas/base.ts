import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { rotuloDoBalde } from "@/lib/painel/numeros";
import {
  baldesDoPeriodo,
  chaveDoBalde,
  truncSql,
  type Periodo,
} from "@/lib/painel/tempo";

/**
 * Base da camada de métricas.
 *
 * Três regras que valem para tudo que é construído em cima daqui:
 *
 * 1. **Nada lê contador denormalizado.** `Novela.viewCount` e companhia foram
 *    semeados com números de vitrine (uma novela marca 12.481 acessos num
 *    banco com 771 eventos no total). O painel deriva de fatos: `Event`,
 *    `WatchProgress`, `AppSession`, `SearchQuery`, `Subscription`, `Payment`.
 *
 * 2. **Todo balde do período existe**, mesmo valendo zero. Dia sem dado que
 *    some do eixo mente sobre a forma da curva.
 *
 * 3. **A assinatura é sempre `(periodo)`.** Se um dia o volume exigir tabelas
 *    de rollup, a troca acontece dentro destas funções e nenhuma tela muda.
 */

export type Ponto = {
  chave: string;
  rotulo: string;
  valor: number;
};

export type Serie = Ponto[];

/** Preenche os baldes vazios do período com o que veio do banco. */
export function completarSerie(
  periodo: Periodo,
  valores: Map<string, number>,
): Serie {
  return baldesDoPeriodo(periodo).map((balde) => ({
    chave: balde.chave,
    rotulo: rotuloDoBalde(balde.chave),
    valor: valores.get(balde.chave) ?? 0,
  }));
}

function nomeSeguro(identificador: string): string {
  // Os nomes vêm de literais do nosso código, nunca de entrada de usuário —
  // a checagem existe para que continue assim depois de qualquer refatoração.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(identificador)) {
    throw new Error(`Identificador SQL inválido: ${identificador}`);
  }
  return identificador;
}

/**
 * Série agregada por balde de tempo.
 *
 * `expressao` é o que se mede (contagem, soma, distintos); `filtro` recorta as
 * linhas. Ambos são `Prisma.Sql`, então valores viajam parametrizados.
 */
export async function serieTemporal(opcoes: {
  tabela: string;
  coluna: string;
  periodo: Periodo;
  expressao?: Prisma.Sql;
  filtro?: Prisma.Sql;
  /** Use a janela anterior em vez da atual. */
  anterior?: boolean;
}): Promise<Serie> {
  const { periodo } = opcoes;
  const janela = opcoes.anterior ? periodo.anterior : periodo;
  const tabela = Prisma.raw(`"${nomeSeguro(opcoes.tabela)}"`);
  const coluna = Prisma.raw(`"${nomeSeguro(opcoes.coluna)}"`);
  const trunc = Prisma.raw(truncSql(periodo.granularidade, nomeSeguro(opcoes.coluna)));
  const expressao = opcoes.expressao ?? Prisma.sql`count(*)::float8`;

  const linhas = await db.$queryRaw<{ balde: Date; valor: number | null }[]>(
    Prisma.sql`
      SELECT ${trunc} AS balde, ${expressao} AS valor
      FROM ${tabela}
      WHERE ${coluna} >= ${janela.inicio} AND ${coluna} < ${janela.fim}
      ${opcoes.filtro ? Prisma.sql`AND ${opcoes.filtro}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `,
  );

  const valores = new Map<string, number>();
  for (const linha of linhas) {
    valores.set(
      chaveDoBalde(periodo.granularidade, linha.balde),
      Number(linha.valor ?? 0),
    );
  }

  // A janela anterior tem os mesmos baldes da atual, deslocados: para
  // sobrepor as duas curvas, o que importa é a posição, não a data.
  if (opcoes.anterior) {
    const baldesAnteriores = baldesDoPeriodo({
      ...periodo,
      inicio: janela.inicio,
      fim: janela.fim,
    });
    const atuais = baldesDoPeriodo(periodo);
    return baldesAnteriores.map((balde, i) => ({
      chave: atuais[i]?.chave ?? balde.chave,
      rotulo: rotuloDoBalde(atuais[i]?.chave ?? balde.chave),
      valor: valores.get(balde.chave) ?? 0,
    }));
  }

  return completarSerie(periodo, valores);
}

/** Um número só, na janela atual e na anterior — a matéria-prima de `indicador`. */
export async function totalNoPeriodo(opcoes: {
  tabela: string;
  coluna: string;
  periodo: Periodo;
  expressao?: Prisma.Sql;
  filtro?: Prisma.Sql;
}): Promise<{ atual: number; anterior: number }> {
  const tabela = Prisma.raw(`"${nomeSeguro(opcoes.tabela)}"`);
  const coluna = Prisma.raw(`"${nomeSeguro(opcoes.coluna)}"`);
  const expressao = opcoes.expressao ?? Prisma.sql`count(*)::float8`;

  const consulta = (inicio: Date, fim: Date) =>
    db.$queryRaw<{ valor: number | null }[]>(Prisma.sql`
      SELECT ${expressao} AS valor
      FROM ${tabela}
      WHERE ${coluna} >= ${inicio} AND ${coluna} < ${fim}
      ${opcoes.filtro ? Prisma.sql`AND ${opcoes.filtro}` : Prisma.empty}
    `);

  const [atual, anterior] = await Promise.all([
    consulta(opcoes.periodo.inicio, opcoes.periodo.fim),
    consulta(opcoes.periodo.anterior.inicio, opcoes.periodo.anterior.fim),
  ]);

  return {
    atual: Number(atual[0]?.valor ?? 0),
    anterior: Number(anterior[0]?.valor ?? 0),
  };
}

// Expressões que se repetem, nomeadas para que a intenção fique legível na
// chamada em vez de virar SQL solto no meio de uma função de tela.
export const CONTAR = Prisma.sql`count(*)::float8`;
export const SOMAR_MS = Prisma.sql`coalesce(sum("valueMs"), 0)::float8`;
/**
 * Pessoas distintas.
 *
 * `count(DISTINCT "userId")` sozinho descarta todo mundo que ainda nao entrou
 * — hoje, 78 das 162 sessoes gravadas. O painel diria "2 pessoas alcancadas"
 * num periodo com 67 dispositivos diferentes. Quem nao tem conta continua
 * sendo gente, e conta pelo dispositivo.
 */
export const PESSOAS_DISTINTAS = Prisma.sql`count(DISTINCT coalesce("userId", "deviceId"))::float8`;

/** So quem tem conta. Use quando a pergunta for sobre usuarios cadastrados. */
export const USUARIOS_DISTINTOS = Prisma.sql`count(DISTINCT "userId")::float8`;

export function eventosDoTipo(...tipos: string[]): Prisma.Sql {
  return Prisma.sql`"type"::text IN (${Prisma.join(tipos)})`;
}

/**
 * Janela de "agora". Cinco minutos: um batimento de sessão cabe com folga, e
 * uma pessoa que fechou o app há três minutos ainda conta como presente para
 * quem está olhando a operação.
 */
export const JANELA_AGORA_MS = 5 * 60_000;

export function agoraMenos(ms: number): Date {
  return new Date(Date.now() - ms);
}
