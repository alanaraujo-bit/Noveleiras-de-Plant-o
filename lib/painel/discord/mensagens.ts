import {
  fmtDuracao,
  fmtMoeda,
  fmtNumero,
  type Indicador,
} from "@/lib/painel/numeros";

/**
 * O que chega no Discord.
 *
 * Um formatador só, dois consumidores: o envio de verdade e a prévia do
 * painel. A prévia não é um desenho parecido com a mensagem — é a mesma
 * mensagem, renderizada. Se as duas vivessem em lugares diferentes, a prévia
 * viraria um mockup que mente assim que alguém mexe num dos lados.
 *
 * Sem `server-only` de propósito: o componente da prévia importa os tipos e
 * os rótulos, e os testes exercitam tudo sem banco.
 */

// ------------------------------------------------------------- formato

export type CampoDiscord = { name: string; value: string; inline?: boolean };

export type EmbedDiscord = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  author?: { name: string };
  fields?: CampoDiscord[];
  footer?: { text: string };
  timestamp?: string;
};

export type MensagemDiscord = {
  username: string;
  content?: string;
  embeds: EmbedDiscord[];
  /** Nome de usuário vira texto, nunca menção — ninguém pinga o canal pelo cadastro. */
  allowed_mentions: { parse: [] };
};

/** Limite do Discord por mensagem. Mais que isso vira outra mensagem. */
export const EMBEDS_POR_MENSAGEM = 10;

const REMETENTE = "Noveleiras de Plantão";

export const CORES = {
  cadastro: 0xe11d74,
  assinatura: 0x22c55e,
  renovacao: 0x14b8a6,
  compra: 0xf59e0b,
  cancelamento: 0x94a3b8,
  falha: 0xef4444,
  alerta: 0xdc2626,
  relatorio: 0x8b5cf6,
} as const;

// ------------------------------------------------------------- eventos

export const TIPOS_DE_EVENTO = {
  cadastro: {
    rotulo: "Novo cadastro",
    descricao: "Cada conta criada: nome, e-mail, como entrou e de qual aparelho.",
  },
  assinatura: {
    rotulo: "Novo assinante",
    descricao: "A primeira cobrança de assinatura aprovada de uma pessoa.",
  },
  renovacao: {
    rotulo: "Renovação",
    descricao: "Cobrança de um novo ciclo aprovada.",
  },
  compra: {
    rotulo: "Compra avulsa",
    descricao: "Novela comprada separadamente, fora da assinatura.",
  },
  cancelamento: {
    rotulo: "Cancelamento",
    descricao: "Quem pediu para cancelar, e até quando ainda tem acesso.",
  },
  falha: {
    rotulo: "Cobrança recusada",
    descricao: "Cartão recusado ou cobrança que não passou.",
  },
  alerta: {
    rotulo: "Alerta crítico",
    descricao: "Servidor fora do ar, disco cheio, mídia sumida.",
  },
} as const;

export type TipoDeEvento = keyof typeof TIPOS_DE_EVENTO;

export const LISTA_DE_EVENTOS = Object.keys(TIPOS_DE_EVENTO) as TipoDeEvento[];

export function ehTipoDeEvento(valor: unknown): valor is TipoDeEvento {
  return typeof valor === "string" && valor in TIPOS_DE_EVENTO;
}

type Pessoa = { userId: string; nome: string; email: string };

export type Fato =
  | (Pessoa & {
      tipo: "cadastro";
      chave: string;
      metodo: "google" | "email";
      aparelho: string | null;
      origem: string | null;
      em: Date;
      /** Contas reais depois desta — "é a 214ª pessoa". */
      totalDeContas: number;
    })
  | (Pessoa & {
      tipo: "assinatura" | "renovacao";
      chave: string;
      plano: string;
      valorCents: number;
      meio: string | null;
      em: Date;
    })
  | (Pessoa & {
      tipo: "compra";
      chave: string;
      novela: string;
      valorCents: number;
      em: Date;
    })
  | (Pessoa & {
      tipo: "cancelamento";
      chave: string;
      plano: string;
      acessoAte: Date | null;
      em: Date;
    })
  | (Pessoa & {
      tipo: "falha";
      chave: string;
      plano: string;
      motivo: string | null;
      em: Date;
    })
  | {
      tipo: "alerta";
      chave: string;
      titulo: string;
      detalhe: string | null;
      em: Date;
    };

// ------------------------------------------------------------- texto

/**
 * Nome de usuário é texto livre. Sem escapar, "**Maria**" chega em negrito e
 * um nome com crase quebra o bloco inteiro.
 */
export function escaparMarkdown(texto: string): string {
  return texto.replace(/([\\*_~`|>#\[\]()-])/g, "\\$1");
}

function cortar(texto: string, limite: number): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite - 1)}…`;
}

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const soData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function fmtJanela(inicio: Date, fim: Date): string {
  return `${dataHora.format(inicio)} → ${dataHora.format(fim)}`;
}

function linkDoPainel(base: string | null, caminho: string): string | undefined {
  return base ? `${base.replace(/\/$/, "")}${caminho}` : undefined;
}

function pessoaEmLinha(p: Pessoa): string {
  return `**${escaparMarkdown(p.nome)}**\n${escaparMarkdown(p.email)}`;
}

// ------------------------------------------------------------- fatos

export function embedDoFato(fato: Fato, base: string | null): EmbedDiscord {
  const timestamp = fato.em.toISOString();

  switch (fato.tipo) {
    case "cadastro":
      return {
        color: CORES.cadastro,
        author: { name: "Novo cadastro" },
        title: cortar(fato.nome, 200),
        url: linkDoPainel(base, `/painel/usuarios/${fato.userId}`),
        fields: [
          { name: "E-mail", value: escaparMarkdown(fato.email), inline: true },
          {
            name: "Entrou por",
            value: fato.metodo === "google" ? "Google" : "E-mail e senha",
            inline: true,
          },
          {
            name: "Aparelho",
            value: fato.aparelho ? escaparMarkdown(fato.aparelho) : "—",
            inline: true,
          },
          ...(fato.origem
            ? [{ name: "Veio de", value: escaparMarkdown(cortar(fato.origem, 200)) }]
            : []),
        ],
        footer: { text: `${fmtNumero(fato.totalDeContas)}ª conta da plataforma` },
        timestamp,
      };

    case "assinatura":
    case "renovacao":
      return {
        color: fato.tipo === "assinatura" ? CORES.assinatura : CORES.renovacao,
        author: { name: fato.tipo === "assinatura" ? "Novo assinante" : "Renovação" },
        title: `${fmtMoeda(fato.valorCents)} · ${fato.plano}`,
        url: linkDoPainel(base, `/painel/usuarios/${fato.userId}`),
        description: pessoaEmLinha(fato),
        fields: fato.meio
          ? [{ name: "Pagou com", value: escaparMarkdown(fato.meio), inline: true }]
          : [],
        timestamp,
      };

    case "compra":
      return {
        color: CORES.compra,
        author: { name: "Compra avulsa" },
        title: `${fmtMoeda(fato.valorCents)} · ${cortar(fato.novela, 180)}`,
        url: linkDoPainel(base, `/painel/usuarios/${fato.userId}`),
        description: pessoaEmLinha(fato),
        timestamp,
      };

    case "cancelamento":
      return {
        color: CORES.cancelamento,
        author: { name: "Cancelamento" },
        title: `${fato.plano} cancelado`,
        url: linkDoPainel(base, `/painel/usuarios/${fato.userId}`),
        description: pessoaEmLinha(fato),
        fields: [
          {
            name: "Acesso até",
            value: fato.acessoAte ? soData.format(fato.acessoAte) : "encerrado agora",
            inline: true,
          },
        ],
        timestamp,
      };

    case "falha":
      return {
        color: CORES.falha,
        author: { name: "Cobrança recusada" },
        title: fato.plano,
        url: linkDoPainel(base, `/painel/usuarios/${fato.userId}`),
        description: pessoaEmLinha(fato),
        fields: fato.motivo
          ? [{ name: "Motivo", value: escaparMarkdown(cortar(fato.motivo, 300)) }]
          : [],
        timestamp,
      };

    case "alerta":
      return {
        color: CORES.alerta,
        author: { name: "Alerta crítico" },
        title: cortar(fato.titulo, 250),
        url: linkDoPainel(base, "/painel/alertas"),
        description: fato.detalhe ? cortar(fato.detalhe, 1500) : undefined,
        timestamp,
      };
  }
}

/** Agrupa fatos em mensagens de até dez embeds — uma rajada vira uma postagem. */
export function mensagensDosFatos(
  fatos: Fato[],
  base: string | null,
): MensagemDiscord[] {
  const mensagens: MensagemDiscord[] = [];
  for (let i = 0; i < fatos.length; i += EMBEDS_POR_MENSAGEM) {
    mensagens.push({
      username: REMETENTE,
      embeds: fatos
        .slice(i, i + EMBEDS_POR_MENSAGEM)
        .map((fato) => embedDoFato(fato, base)),
      allowed_mentions: { parse: [] },
    });
  }
  return mensagens;
}

export function resumoDoFato(fato: Fato): string {
  switch (fato.tipo) {
    case "cadastro":
      return `Cadastro · ${fato.nome}`;
    case "assinatura":
      return `Novo assinante · ${fato.nome} · ${fmtMoeda(fato.valorCents)}`;
    case "renovacao":
      return `Renovação · ${fato.nome} · ${fmtMoeda(fato.valorCents)}`;
    case "compra":
      return `Compra · ${fato.nome} · ${fato.novela}`;
    case "cancelamento":
      return `Cancelamento · ${fato.nome}`;
    case "falha":
      return `Cobrança recusada · ${fato.nome}`;
    case "alerta":
      return `Alerta · ${fato.titulo}`;
  }
}

// ------------------------------------------------------------ relatório

export type DadosDoRelatorio = {
  rotuloDoIntervalo: string;
  inicio: Date;
  fim: Date;

  cadastros: Indicador;
  contasTotais: number;
  novosAssinantes: Indicador;
  cancelamentos: Indicador;
  assinantesAtivos: number;
  mrrCents: number;
  receitaCents: Indicador;

  tempoAssistidoMs: Indicador;
  reproducoes: Indicador;
  espectadores: Indicador;
  sessoes: Indicador;

  errosDoSistema: number;
  alertasAbertos: number;

  maisAssistidas: { titulo: string; reproducoes: number; tempoAssistidoMs: number }[];
  quemChegou: string[];
};

/** "▲ 12%" contra a janela anterior. Sem base, não inventa percentual. */
export function fmtComparacao(ind: Indicador): string {
  if (ind.anterior === null) return "";
  if (ind.variacao === null) {
    return ind.valor > 0 ? " · antes: 0" : "";
  }
  const pct = Math.round(ind.variacao * 100);
  if (pct === 0) return " · = anterior";
  return ` · ${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`;
}

function linha(valor: string, ind: Indicador): string {
  return `**${valor}**${fmtComparacao(ind)}`;
}

export function mensagemDoRelatorio(
  d: DadosDoRelatorio,
  base: string | null,
): MensagemDiscord {
  const top = d.maisAssistidas
    .slice(0, 5)
    .map(
      (n, i) =>
        `${i + 1}. ${escaparMarkdown(n.titulo)} — ${fmtNumero(n.reproducoes)} plays · ${fmtDuracao(n.tempoAssistidoMs)}`,
    )
    .join("\n");

  const chegaram =
    d.quemChegou.length === 0
      ? null
      : d.quemChegou
          .slice(0, 8)
          .map((nome) => escaparMarkdown(nome))
          .join(", ") +
        (d.cadastros.valor > d.quemChegou.slice(0, 8).length
          ? ` e mais ${fmtNumero(d.cadastros.valor - Math.min(8, d.quemChegou.length))}`
          : "");

  const saude =
    d.alertasAbertos === 0 && d.errosDoSistema === 0
      ? "Tudo em ordem — nenhum alerta aberto, nenhum erro registrado."
      : `${fmtNumero(d.alertasAbertos)} ${d.alertasAbertos === 1 ? "alerta aberto" : "alertas abertos"} · ${fmtNumero(d.errosDoSistema)} ${d.errosDoSistema === 1 ? "erro" : "erros"} no período`;

  const campos: CampoDiscord[] = [
    { name: "Cadastros", value: linha(fmtNumero(d.cadastros.valor), d.cadastros), inline: true },
    { name: "Novos assinantes", value: linha(fmtNumero(d.novosAssinantes.valor), d.novosAssinantes), inline: true },
    { name: "Receita", value: linha(fmtMoeda(d.receitaCents.valor), d.receitaCents), inline: true },

    { name: "Horas assistidas", value: linha(fmtDuracao(d.tempoAssistidoMs.valor), d.tempoAssistidoMs), inline: true },
    { name: "Reproduções", value: linha(fmtNumero(d.reproducoes.valor), d.reproducoes), inline: true },
    { name: "Pessoas ativas", value: linha(fmtNumero(d.espectadores.valor), d.espectadores), inline: true },

    { name: "Assinantes ativos", value: `**${fmtNumero(d.assinantesAtivos)}**`, inline: true },
    { name: "MRR", value: `**${fmtMoeda(d.mrrCents)}**`, inline: true },
    { name: "Cancelamentos", value: linha(fmtNumero(d.cancelamentos.valor), d.cancelamentos), inline: true },
  ];

  if (top) campos.push({ name: "Mais assistidas", value: top });
  if (chegaram) campos.push({ name: "Quem chegou", value: cortar(chegaram, 1000) });
  campos.push({ name: "Saúde", value: saude });

  return {
    username: REMETENTE,
    embeds: [
      {
        color: CORES.relatorio,
        author: { name: `Relatório · ${d.rotuloDoIntervalo.toLowerCase()}` },
        title: fmtJanela(d.inicio, d.fim),
        url: linkDoPainel(base, "/painel"),
        description: `${fmtNumero(d.contasTotais)} contas no total · ${fmtNumero(d.sessoes.valor)} sessões no período`,
        fields: campos,
        footer: { text: "Comparado com a janela anterior de mesma duração" },
        timestamp: d.fim.toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// ---------------------------------------------------------------- teste

export function mensagemDeTeste(operador: string): MensagemDiscord {
  return {
    username: REMETENTE,
    embeds: [
      {
        color: CORES.cadastro,
        author: { name: "Teste de conexão" },
        title: "O canal está ligado ao painel",
        description: `Enviado por ${escaparMarkdown(operador)} pela tela de Notificações. Daqui para frente, o que estiver marcado lá chega aqui.`,
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
