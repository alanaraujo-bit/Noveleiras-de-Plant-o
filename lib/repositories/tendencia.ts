import "server-only";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { pontuarTendencia, type Tendencia } from "@/lib/recomendacao/sinais";

/**
 * O que está em alta, lido dos fatos.
 *
 * Antes era `Novela.viewCount`: um contador de sempre, que só cresce e nunca
 * esquece. Uma novela vista muito há dois meses ficava no topo para sempre, e
 * uma que todo mundo começou ontem demorava semanas para aparecer. Agora a
 * resposta vem do log de eventos dos últimos dias — tempo assistido, pessoas
 * distintas e quanto a abertura segura quem começa — e o contador só desempata
 * quem não tem sinal recente.
 *
 * Nada vai para o banco: a tendência é recalculada do log, e por isso sempre
 * bate com o que o painel mostra. Ela só fica alguns minutos na memória do
 * servidor — é a mesma para todo mundo, e refazer a agregação a cada abertura
 * do reel custava mais de um segundo para mudar quase nada.
 *
 * A memória é do processo, não compartilhada: cada instância do servidor
 * guarda a sua. O preço aceito é que o "em alta" pode chegar com até cinco
 * minutos de atraso, e duas instâncias podem discordar nesse intervalo. Para
 * uma lista que muda em horas, é imperceptível; se um dia precisar ser exata
 * entre instâncias, o caminho é o `"use cache"` com `cacheLife`, que exige
 * ligar o Cache Components no app.
 */

/** Por quanto tempo a tendência calculada vale antes de ser refeita. */
const VALIDADE_MS = 5 * 60_000;

let guardada: { em: number; valor: Promise<Map<string, Tendencia>> } | null = null;

/** Janela lida. Com meia-vida de três dias, o que passa disso quase não pesa. */
const JANELA_DIAS = 14;
/** Metade do peso de um minuto assistido a cada três dias. */
const MEIA_VIDA_DIAS = 3;

type Linha = {
  novelaId: string;
  viewCount: number;
  minutos: number;
  espectadores: number;
  ficaram: number;
  passaram: number;
};

/**
 * Guardada por alguns minutos na memória do processo. A promessa fica guardada
 * (e não o resultado), então dez aberturas simultâneas disparam uma consulta
 * só. Se a consulta falha, nada fica guardado e a próxima tenta de novo.
 */
export function tendenciaDoCatalogo(): Promise<Map<string, Tendencia>> {
  const agora = Date.now();
  if (guardada && agora - guardada.em < VALIDADE_MS) return guardada.valor;

  const valor = calcularTendencia();
  guardada = { em: agora, valor };
  valor.catch(() => {
    if (guardada?.valor === valor) guardada = null;
  });
  return valor;
}

async function calcularTendencia(): Promise<Map<string, Tendencia>> {
  const agora = new Date();
  const desde = new Date(agora.getTime() - JANELA_DIAS * 86_400_000);

  // O relógio vai como parâmetro, e não `now()` do Postgres: as colunas são
  // UTC sem fuso, e a subtração com `now()` dependeria do fuso da sessão.
  const linhas = await db.$queryRaw<Linha[]>(Prisma.sql`
    SELECT
      n."id"                                        AS "novelaId",
      n."viewCount"::int                            AS "viewCount",
      coalesce(a."minutos", 0)::float8              AS "minutos",
      coalesce(a."espectadores", 0)::int            AS "espectadores",
      coalesce(a."ficaram", 0)::int                 AS "ficaram",
      coalesce(a."passaram", 0)::int                AS "passaram"
    FROM "Novela" n
    LEFT JOIN (
      SELECT
        e."novelaId",
        sum(
          e."valueMs" * power(
            0.5,
            extract(epoch FROM (${agora}::timestamp - e."createdAt")) / ${MEIA_VIDA_DIAS * 86_400}
          )
        ) FILTER (WHERE e."type"::text = 'PLAY_PROGRESS') / 60000.0       AS "minutos",
        count(DISTINCT e."userId") FILTER (WHERE e."type"::text = 'PLAY_PROGRESS') AS "espectadores",
        count(*) FILTER (
          WHERE e."type"::text = 'REEL_SLIDE_VIEW' AND e."payload"->>'origem' = 'gancho'
        )                                                                  AS "ficaram",
        -- Só o descarte da abertura diz se o começo segura. Pular o episódio
        -- 30 de uma série que a pessoa está assistindo é outra coisa, e contar
        -- esses derrubava justamente as novelas mais maratonadas.
        count(*) FILTER (
          WHERE e."type"::text = 'REEL_SLIDE_SKIP' AND ep."number" = 1
        )                                                                  AS "passaram"
      FROM "Event" e
      LEFT JOIN "Episode" ep ON ep."id" = e."episodeId"
      WHERE e."createdAt" >= ${desde}
        AND e."novelaId" IS NOT NULL
        AND e."type"::text IN ('PLAY_PROGRESS', 'REEL_SLIDE_VIEW', 'REEL_SLIDE_SKIP')
      GROUP BY e."novelaId"
    ) a ON a."novelaId" = n."id"
    WHERE n."status"::text <> 'COMING_SOON'
  `);

  return new Map(
    linhas.map((l) => [
      l.novelaId,
      pontuarTendencia({
        minutosRecentes: l.minutos,
        espectadores: l.espectadores,
        ficaram: l.ficaram,
        passaram: l.passaram,
        visualizacoesDeSempre: l.viewCount,
      }),
    ]),
  );
}

/** Pontuação de uma novela, ou zero para quem ficou fora da leitura. */
export function valorDaTendencia(
  tendencia: Map<string, Tendencia>,
  novelaId: string,
): number {
  return tendencia.get(novelaId)?.valor ?? 0;
}
