import "server-only";

import { Prisma, type SubscriptionPlan } from "@prisma/client";

import { db } from "@/lib/db";
import {
  conteudoMaisAssistido,
  resumoDaVisao,
} from "@/lib/painel/metricas/visao";
import { PLANOS } from "@/lib/painel/planos";
import type { Periodo } from "@/lib/painel/tempo";
import {
  ehIntervalo,
  INTERVALOS,
  type Intervalo,
  type Janela,
} from "@/lib/painel/discord/janelas";
import {
  ehTipoDeEvento,
  type DadosDoRelatorio,
  type Fato,
  type TipoDeEvento,
} from "@/lib/painel/discord/mensagens";

/**
 * De onde saem as notificações.
 *
 * Nenhum fluxo do produto "avisa" o Discord. As notificações são derivadas dos
 * fatos que já estão no banco — `User`, `Payment`, `Purchase`,
 * `SubscriptionEvent`, `Alert` — pela mesma razão que o motor de alertas faz
 * assim: um aviso que depende de cada tela lembrar de chamá-lo some no dia em
 * que alguém cria um caminho novo de cadastro e esquece.
 *
 * Dado de demonstração (`isDemo`) nunca vira notificação.
 */

// ------------------------------------------------------------ configuração

export type ConfigDoDiscord = {
  webhookUrl: string | null;
  ativo: boolean;
  eventos: TipoDeEvento[];
  relatorioAtivo: boolean;
  relatorioIntervalo: Intervalo;
  relatorioHora: number;
  eventosDesde: Date;
  atualizadoPor: string | null;
  atualizadoEm: Date | null;
};

export const CONFIG_PADRAO: ConfigDoDiscord = {
  webhookUrl: null,
  ativo: false,
  eventos: ["cadastro", "assinatura", "compra", "cancelamento", "falha", "alerta"],
  relatorioAtivo: true,
  relatorioIntervalo: "diario",
  relatorioHora: 8,
  eventosDesde: new Date(0),
  atualizadoPor: null,
  atualizadoEm: null,
};

/** A tabela ainda não existe neste banco: a migração não foi aplicada. */
export function ehTabelaAusente(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2021"
  );
}

export async function lerConfig(): Promise<{
  tabelaPronta: boolean;
  config: ConfigDoDiscord;
}> {
  try {
    const linha = await db.discordConfig.findUnique({ where: { id: "principal" } });
    if (!linha) return { tabelaPronta: true, config: CONFIG_PADRAO };
    return {
      tabelaPronta: true,
      config: {
        webhookUrl: linha.webhookUrl,
        ativo: linha.ativo,
        eventos: linha.eventos.filter(ehTipoDeEvento),
        relatorioAtivo: linha.relatorioAtivo,
        relatorioIntervalo: ehIntervalo(linha.relatorioIntervalo)
          ? linha.relatorioIntervalo
          : "diario",
        relatorioHora: linha.relatorioHora,
        eventosDesde: linha.eventosDesde,
        atualizadoPor: linha.atualizadoPor,
        atualizadoEm: linha.updatedAt,
      },
    };
  } catch (erro) {
    if (ehTabelaAusente(erro)) return { tabelaPronta: false, config: CONFIG_PADRAO };
    throw erro;
  }
}

/** Endereço público do app, para os links das mensagens. */
export function baseDoApp(): string | null {
  const explicito = process.env.APP_URL?.trim();
  if (explicito) return explicito;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

// ------------------------------------------------------------------ fatos

function nomeDoPlano(plano: SubscriptionPlan | null): string {
  if (!plano) return "Compra avulsa";
  return PLANOS[plano]?.nome ?? plano;
}

function nomeDoMeio(metodo: string | null): string | null {
  if (!metodo) return null;
  const m = metodo.toLowerCase();
  if (m === "pix") return "Pix";
  if (m.includes("credit") || m === "visa" || m === "master" || m === "elo" || m === "amex") {
    return "Cartão de crédito";
  }
  if (m.includes("debit")) return "Cartão de débito";
  if (m === "demo" || m === "mock") return "Simulado";
  return metodo;
}

function aparelhoDaSessao(
  sessao: { osName: string | null; browser: string | null; standalone: boolean } | undefined,
): string | null {
  if (!sessao) return null;
  const partes = [sessao.osName, sessao.browser].filter(Boolean).join(" · ");
  if (!partes) return sessao.standalone ? "App instalado" : null;
  return sessao.standalone ? `${partes} (app instalado)` : partes;
}

function origemDaSessao(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer;
  }
}

type OpcoesDeColeta = {
  desde: Date;
  tipos: ReadonlySet<TipoDeEvento>;
  /** Por tipo. Um dia de rajada não pode virar cem mensagens. */
  limite?: number;
  /** Os mais novos primeiro — para a prévia, que quer o último de cada tipo. */
  maisRecentes?: boolean;
};

export async function coletarFatos({
  desde,
  tipos,
  limite = 30,
  maisRecentes = false,
}: OpcoesDeColeta): Promise<Fato[]> {
  const ordem = maisRecentes ? ("desc" as const) : ("asc" as const);
  const fatos: Fato[] = [];

  const [cadastros, pagamentos, compras, cancelamentos, falhas, alertas] =
    await Promise.all([
      tipos.has("cadastro")
        ? db.user.findMany({
            where: { createdAt: { gte: desde }, isDemo: false },
            orderBy: { createdAt: ordem },
            take: limite,
            select: {
              id: true,
              name: true,
              email: true,
              googleSubject: true,
              createdAt: true,
              sessions: {
                orderBy: { startedAt: "asc" },
                take: 1,
                select: { osName: true, browser: true, standalone: true, referrer: true },
              },
            },
          })
        : [],

      tipos.has("assinatura") || tipos.has("renovacao")
        ? db.payment.findMany({
            where: {
              createdAt: { gte: desde },
              status: "APPROVED",
              kind: "SUBSCRIPTION",
              isDemo: false,
            },
            orderBy: { createdAt: ordem },
            take: limite * 2,
            select: {
              id: true,
              userId: true,
              plan: true,
              amountCents: true,
              method: true,
              createdAt: true,
            },
          })
        : [],

      tipos.has("compra")
        ? db.purchase.findMany({
            where: { status: "PAID", paidAt: { gte: desde }, isDemo: false },
            orderBy: { paidAt: ordem },
            take: limite,
            select: {
              id: true,
              userId: true,
              amountCents: true,
              paidAt: true,
              createdAt: true,
              user: { select: { name: true, email: true } },
              novela: { select: { title: true } },
            },
          })
        : [],

      tipos.has("cancelamento")
        ? db.subscriptionEvent.findMany({
            where: {
              createdAt: { gte: desde },
              type: { in: ["CANCEL_REQUESTED", "CANCELED"] },
              user: { isDemo: false },
            },
            orderBy: { createdAt: ordem },
            take: limite,
            select: {
              subscriptionId: true,
              userId: true,
              periodEnd: true,
              createdAt: true,
              user: { select: { name: true, email: true } },
              subscription: { select: { plan: true, currentPeriodEnd: true } },
            },
          })
        : [],

      tipos.has("falha")
        ? db.payment.findMany({
            where: { createdAt: { gte: desde }, status: "FAILED", isDemo: false },
            orderBy: { createdAt: ordem },
            take: limite,
            select: {
              id: true,
              userId: true,
              plan: true,
              kind: true,
              failureMessage: true,
              failureCode: true,
              createdAt: true,
            },
          })
        : [],

      tipos.has("alerta")
        ? db.alert.findMany({
            where: { severity: "CRITICAL", openedAt: { gte: desde } },
            orderBy: { openedAt: ordem },
            take: limite,
            select: { id: true, title: true, detail: true, openedAt: true },
          })
        : [],
    ]);

  // --- cadastros: "é a 214ª conta" precisa da base anterior ao lote.
  if (cadastros.length > 0) {
    const maisAntigo = cadastros.reduce(
      (min, u) => (u.createdAt < min ? u.createdAt : min),
      cadastros[0].createdAt,
    );
    const antes = await db.user.count({
      where: { createdAt: { lt: maisAntigo }, isDemo: false },
    });
    const emOrdem = [...cadastros].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    emOrdem.forEach((u, i) => {
      const sessao = u.sessions[0];
      fatos.push({
        tipo: "cadastro",
        chave: `cadastro:${u.id}`,
        userId: u.id,
        nome: u.name,
        email: u.email,
        metodo: u.googleSubject ? "google" : "email",
        aparelho: aparelhoDaSessao(sessao),
        origem: origemDaSessao(sessao?.referrer),
        em: u.createdAt,
        totalDeContas: antes + i + 1,
      });
    });
  }

  // --- pagamentos precisam do nome da pessoa (Payment não tem relação com User)
  //     e de saber se é a primeira cobrança dela: primeira é assinante novo,
  //     as seguintes são renovação.
  const idsDePessoas = [
    ...new Set([...pagamentos.map((p) => p.userId), ...falhas.map((f) => f.userId)]),
  ];
  const pessoas = idsDePessoas.length
    ? await db.user.findMany({
        where: { id: { in: idsDePessoas } },
        select: { id: true, name: true, email: true, isDemo: true },
      })
    : [];
  const pessoaPorId = new Map(pessoas.map((p) => [p.id, p]));

  if (pagamentos.length > 0) {
    const anteriores = await db.payment.groupBy({
      by: ["userId"],
      where: {
        userId: { in: [...new Set(pagamentos.map((p) => p.userId))] },
        status: "APPROVED",
        kind: "SUBSCRIPTION",
        isDemo: false,
      },
      _min: { createdAt: true },
    });
    const primeiraPorPessoa = new Map(
      anteriores.map((a) => [a.userId, a._min.createdAt?.getTime() ?? 0]),
    );

    for (const p of pagamentos) {
      const pessoa = pessoaPorId.get(p.userId);
      if (!pessoa || pessoa.isDemo) continue;
      const primeira = primeiraPorPessoa.get(p.userId) === p.createdAt.getTime();
      const tipo = primeira ? "assinatura" : "renovacao";
      if (!tipos.has(tipo)) continue;
      fatos.push({
        tipo,
        chave: `pagamento:${p.id}`,
        userId: p.userId,
        nome: pessoa.name,
        email: pessoa.email,
        plano: nomeDoPlano(p.plan),
        valorCents: p.amountCents,
        meio: nomeDoMeio(p.method),
        em: p.createdAt,
      });
    }
  }

  for (const c of compras) {
    fatos.push({
      tipo: "compra",
      chave: `compra:${c.id}`,
      userId: c.userId,
      nome: c.user.name,
      email: c.user.email,
      novela: c.novela.title,
      valorCents: c.amountCents,
      em: c.paidAt ?? c.createdAt,
    });
  }

  // Pedido de cancelamento e o cancelamento do provedor são o mesmo fim de
  // ciclo: a chave pelo ciclo faz os dois virarem uma notificação só.
  for (const c of cancelamentos) {
    const ate = c.periodEnd ?? c.subscription.currentPeriodEnd;
    fatos.push({
      tipo: "cancelamento",
      chave: `cancelamento:${c.subscriptionId}:${ate ? ate.toISOString() : "imediato"}`,
      userId: c.userId,
      nome: c.user.name,
      email: c.user.email,
      plano: nomeDoPlano(c.subscription.plan),
      acessoAte: ate && ate > c.createdAt ? ate : null,
      em: c.createdAt,
    });
  }

  for (const f of falhas) {
    const pessoa = pessoaPorId.get(f.userId);
    if (!pessoa || pessoa.isDemo) continue;
    fatos.push({
      tipo: "falha",
      chave: `falha:${f.id}`,
      userId: f.userId,
      nome: pessoa.name,
      email: pessoa.email,
      plano: f.kind === "TITLE_PURCHASE" ? "Compra avulsa" : nomeDoPlano(f.plan),
      motivo: f.failureMessage ?? f.failureCode,
      em: f.createdAt,
    });
  }

  for (const a of alertas) {
    fatos.push({
      tipo: "alerta",
      chave: `alerta:${a.id}`,
      titulo: a.title,
      detalhe: a.detail,
      em: a.openedAt,
    });
  }

  return fatos.sort((a, b) =>
    maisRecentes
      ? b.em.getTime() - a.em.getTime()
      : a.em.getTime() - b.em.getTime(),
  );
}

// -------------------------------------------------------------- relatório

function periodoDaJanela(janela: Janela): Periodo {
  const duracao = janela.fim.getTime() - janela.inicio.getTime();
  return {
    chave: "personalizado",
    rotulo: "janela do relatório",
    inicio: janela.inicio,
    fim: janela.fim,
    granularidade: duracao <= 2 * 86_400_000 ? "hora" : "dia",
    anterior: { inicio: new Date(janela.inicio.getTime() - duracao), fim: janela.inicio },
  };
}

/**
 * Os números do relatório vêm da mesma função que desenha a Visão geral. O
 * Discord e o painel nunca discordam sobre quantas pessoas chegaram ontem.
 */
export async function coletarRelatorio(
  janela: Janela,
  intervalo: Intervalo,
): Promise<DadosDoRelatorio> {
  const periodo = periodoDaJanela(janela);

  const [resumo, maisAssistidas, chegaram, alertasAbertos] = await Promise.all([
    resumoDaVisao(periodo),
    conteudoMaisAssistido(periodo, 5),
    db.user.findMany({
      where: {
        createdAt: { gte: janela.inicio, lt: janela.fim },
        isDemo: false,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { name: true },
    }),
    db.alert.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
  ]);

  return {
    rotuloDoIntervalo: INTERVALOS[intervalo].rotulo,
    inicio: janela.inicio,
    fim: janela.fim,

    cadastros: resumo.novosUsuarios,
    contasTotais: resumo.usuariosTotais,
    novosAssinantes: resumo.novosAssinantes,
    cancelamentos: resumo.cancelamentos,
    assinantesAtivos: resumo.assinantesAtivos,
    mrrCents: resumo.mrr.cents,
    receitaCents: resumo.receitaCents,

    tempoAssistidoMs: resumo.tempoAssistidoMs,
    reproducoes: resumo.reproducoes,
    espectadores: resumo.espectadores,
    sessoes: resumo.sessoes,

    errosDoSistema: resumo.falhas.valor,
    alertasAbertos,

    maisAssistidas: maisAssistidas.map((n) => ({
      titulo: n.titulo,
      reproducoes: n.reproducoes,
      tempoAssistidoMs: n.tempoAssistidoMs,
    })),
    quemChegou: chegaram.map((u) => u.name),
  };
}

// ------------------------------------------------------------ para o painel

export type CadastroRecente = {
  id: string;
  nome: string;
  email: string;
  handle: string;
  metodo: "google" | "email";
  plano: string;
  assinante: boolean;
  aparelho: string | null;
  criadoEm: Date;
  visto: Date | null;
};

export async function ultimosCadastros(limite = 12): Promise<CadastroRecente[]> {
  const linhas = await db.user.findMany({
    where: { isDemo: false },
    orderBy: { createdAt: "desc" },
    take: limite,
    select: {
      id: true,
      name: true,
      email: true,
      handle: true,
      googleSubject: true,
      createdAt: true,
      lastSeenAt: true,
      subscription: { select: { plan: true, status: true } },
      sessions: {
        orderBy: { startedAt: "asc" },
        take: 1,
        select: { osName: true, browser: true, standalone: true },
      },
    },
  });

  return linhas.map((u) => {
    const plano = u.subscription?.plan ?? "FREE";
    return {
      id: u.id,
      nome: u.name,
      email: u.email,
      handle: u.handle,
      metodo: u.googleSubject ? "google" : "email",
      plano: nomeDoPlano(plano),
      assinante:
        plano !== "FREE" &&
        (u.subscription?.status === "ACTIVE" || u.subscription?.status === "TRIALING"),
      aparelho: aparelhoDaSessao(u.sessions[0]),
      criadoEm: u.createdAt,
      visto: u.lastSeenAt,
    };
  });
}

export type EntregaRecente = {
  id: string;
  tipo: string;
  estado: string;
  resumo: string | null;
  erro: string | null;
  tentativas: number;
  teste: boolean;
  criadoEm: Date;
  enviadoEm: Date | null;
};

export async function historicoDeEntregas(limite = 25): Promise<EntregaRecente[]> {
  try {
    const linhas = await db.discordEntrega.findMany({
      orderBy: { createdAt: "desc" },
      take: limite,
    });
    return linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      estado: l.estado,
      resumo: l.resumo,
      erro: l.erro,
      tentativas: l.tentativas,
      teste: l.teste,
      criadoEm: l.createdAt,
      enviadoEm: l.enviadoEm,
    }));
  } catch (erro) {
    if (ehTabelaAusente(erro)) return [];
    throw erro;
  }
}
