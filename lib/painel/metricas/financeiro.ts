import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { indicador, type Indicador } from "@/lib/painel/numeros";
import { PLANOS } from "@/lib/painel/planos";
import type { Periodo } from "@/lib/painel/tempo";
import {
  serieTemporal,
  totalNoPeriodo,
  type Serie,
} from "@/lib/painel/metricas/base";

/**
 * Financeiro.
 *
 * Duas fontes com naturezas diferentes: `Subscription` é estado (o que está
 * contratado agora) e `Payment` é fato (o dinheiro que entrou). MRR sai da
 * primeira, receita sai da segunda, e as duas nunca são somadas — misturar
 * receita realizada com receita contratada é o jeito clássico de um painel
 * mentir sem que ninguém perceba.
 *
 * O problema herdado: a Fase 01 gravou `priceCents` nulo em quase toda
 * assinatura. A regra é a de `lib/painel/planos.ts` — o preço gravado sempre
 * vence, o catálogo só entra como fallback, e a tela declara quantas
 * assinaturas estão sendo estimadas. Um número estimado que se anuncia é útil;
 * um que se disfarça de exato é dívida.
 */

export type Cobertura = {
  total: number;
  comPrecoGravado: number;
  estimadas: number;
};

export type LinhaDePlano = {
  plano: string;
  nome: string;
  cor: string;
  assinantes: number;
  mrrCents: number;
  estimadas: number;
  precoDeTabelaCents: number;
};

export type ResumoFinanceiro = {
  mrrCents: number;
  arrCents: number;
  assinantesPagantes: number;
  ticketMedioCents: number | null;
  cobertura: Cobertura;
  porPlano: LinhaDePlano[];
  porStatus: { status: string; total: number }[];
  emTeste: number;
  inadimplentes: number;
  cancelamentoAgendado: number;
  novasNoPeriodo: Indicador;
  canceladasNoPeriodo: Indicador;
  /** Receita realizada — só de `Payment`, nunca inferida de assinatura. */
  receita: {
    aprovadaCents: number;
    reembolsadaCents: number;
    liquidaCents: number;
    falhasCents: number;
    pagamentos: number;
    falhas: number;
    demoCents: number;
    serie: Serie;
    temRegistro: boolean;
  };
};

/** Assinaturas que efetivamente pagam: fora FREE, e num status que cobra. */
const STATUS_QUE_PAGA = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

export async function resumoFinanceiro(
  periodo: Periodo,
): Promise<ResumoFinanceiro> {
  const [assinaturas, porStatus, novas, canceladas, pagamentos, seriePagamentos] =
    await Promise.all([
      db.subscription.findMany({
        where: { plan: { not: "FREE" }, status: { in: [...STATUS_QUE_PAGA] } },
        select: { plan: true, priceCents: true, status: true },
      }),
      db.subscription.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      totalNoPeriodo({ tabela: "Subscription", coluna: "startedAt", periodo }),
      totalNoPeriodo({
        tabela: "Subscription",
        coluna: "canceledAt",
        periodo,
        filtro: Prisma.sql`"canceledAt" IS NOT NULL`,
      }),
      db.$queryRaw<
        {
          aprovada: number | null;
          reembolsada: number | null;
          falhas: number | null;
          pagamentos: number;
          quantasFalhas: number;
          demo: number | null;
        }[]
      >(Prisma.sql`
        SELECT
          coalesce(sum("amountCents") FILTER (WHERE "status"::text = 'APPROVED' AND NOT "isDemo"), 0)::float8 AS aprovada,
          coalesce(sum("refundedCents") FILTER (WHERE NOT "isDemo"), 0)::float8 AS reembolsada,
          coalesce(sum("amountCents") FILTER (WHERE "status"::text IN ('FAILED','CHARGEBACK') AND NOT "isDemo"), 0)::float8 AS falhas,
          count(*) FILTER (WHERE "status"::text = 'APPROVED' AND NOT "isDemo")::int AS pagamentos,
          count(*) FILTER (WHERE "status"::text IN ('FAILED','CHARGEBACK') AND NOT "isDemo")::int AS "quantasFalhas",
          coalesce(sum("amountCents") FILTER (WHERE "isDemo"), 0)::float8 AS demo
        FROM "Payment"
        WHERE "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
      `),
      serieTemporal({
        tabela: "Payment",
        coluna: "createdAt",
        periodo,
        expressao: Prisma.sql`coalesce(sum("amountCents"), 0)::float8`,
        filtro: Prisma.sql`"status"::text = 'APPROVED' AND NOT "isDemo"`,
      }),
    ]);

  // MRR: preço gravado quando existe, tabela quando não. A contagem de
  // estimadas anda junto do número para que a tela não possa esquecê-la.
  const porPlano = new Map<string, LinhaDePlano>();
  let mrrCents = 0;
  let comPrecoGravado = 0;

  for (const assinatura of assinaturas) {
    const definicao = PLANOS[assinatura.plan];
    const linha = porPlano.get(assinatura.plan) ?? {
      plano: assinatura.plan,
      nome: definicao?.nome ?? assinatura.plan,
      cor: definicao?.cor ?? "#6f5f6a",
      assinantes: 0,
      mrrCents: 0,
      estimadas: 0,
      precoDeTabelaCents: definicao?.precoCents ?? 0,
    };

    const gravado = assinatura.priceCents;
    const valor = gravado ?? definicao?.precoCents ?? 0;
    if (gravado === null) linha.estimadas += 1;
    else comPrecoGravado += 1;

    linha.assinantes += 1;
    linha.mrrCents += valor;
    mrrCents += valor;
    porPlano.set(assinatura.plan, linha);
  }

  const bruto = pagamentos[0];
  const aprovadaCents = Number(bruto?.aprovada ?? 0);
  const reembolsadaCents = Number(bruto?.reembolsada ?? 0);
  const quantosPagamentos = Number(bruto?.pagamentos ?? 0);

  const totalPagamentosNoPeriodo = await db.payment.count({
    where: { createdAt: { gte: periodo.inicio, lt: periodo.fim } },
  });

  return {
    mrrCents,
    // ARR aqui é MRR × 12, não uma projeção: nenhuma sazonalidade, nenhum
    // churn previsto. É a leitura anualizada do contratado hoje.
    arrCents: mrrCents * 12,
    assinantesPagantes: assinaturas.length,
    ticketMedioCents:
      assinaturas.length > 0 ? Math.round(mrrCents / assinaturas.length) : null,
    cobertura: {
      total: assinaturas.length,
      comPrecoGravado,
      estimadas: assinaturas.length - comPrecoGravado,
    },
    porPlano: [...porPlano.values()].sort((a, b) => b.mrrCents - a.mrrCents),
    porStatus: porStatus.map((linha) => ({
      status: linha.status,
      total: linha._count._all,
    })),
    emTeste: porStatus.find((l) => l.status === "TRIALING")?._count._all ?? 0,
    inadimplentes: porStatus.find((l) => l.status === "PAST_DUE")?._count._all ?? 0,
    cancelamentoAgendado: await db.subscription.count({
      where: { cancelAtPeriodEnd: true, status: { in: [...STATUS_QUE_PAGA] } },
    }),
    novasNoPeriodo: indicador(novas.atual, novas.anterior),
    canceladasNoPeriodo: indicador(canceladas.atual, canceladas.anterior),
    receita: {
      aprovadaCents,
      reembolsadaCents,
      liquidaCents: aprovadaCents - reembolsadaCents,
      falhasCents: Number(bruto?.falhas ?? 0),
      pagamentos: quantosPagamentos,
      falhas: Number(bruto?.quantasFalhas ?? 0),
      demoCents: Number(bruto?.demo ?? 0),
      serie: seriePagamentos,
      temRegistro: totalPagamentosNoPeriodo > 0,
    },
  };
}

export type LinhaDeAssinatura = {
  id: string;
  usuario: { id: string; nome: string; email: string; handle: string } | null;
  plano: string;
  status: string;
  precoCents: number;
  estimado: boolean;
  provedor: string | null;
  inicio: Date;
  fimDoPeriodo: Date | null;
  cancelaNoFim: boolean;
  canceladaEm: Date | null;
  fimDoTeste: Date | null;
};

export const PLANOS_VALIDOS = ["FREE", "PREMIUM", "VIP"] as const;
export const STATUS_VALIDOS = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
] as const;

export async function listarAssinaturas(filtro: {
  termo?: string;
  plano?: string;
  status?: string;
  pagina?: number;
  porPagina?: number;
}): Promise<{
  linhas: LinhaDeAssinatura[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, filtro.porPagina ?? 25));
  const pagina = Math.max(1, filtro.pagina ?? 1);

  const onde: Prisma.SubscriptionWhereInput = {};
  if (filtro.termo?.trim()) {
    const termo = filtro.termo.trim();
    onde.user = {
      OR: [
        { email: { contains: termo, mode: "insensitive" } },
        { name: { contains: termo, mode: "insensitive" } },
        { handle: { contains: termo, mode: "insensitive" } },
      ],
    };
  }
  if (filtro.plano && (PLANOS_VALIDOS as readonly string[]).includes(filtro.plano)) {
    onde.plan = filtro.plano as (typeof PLANOS_VALIDOS)[number];
  }
  if (
    filtro.status &&
    (STATUS_VALIDOS as readonly string[]).includes(filtro.status)
  ) {
    onde.status = filtro.status as (typeof STATUS_VALIDOS)[number];
  }

  const [total, assinaturas] = await Promise.all([
    db.subscription.count({ where: onde }),
    db.subscription.findMany({
      where: onde,
      orderBy: { startedAt: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      select: {
        id: true,
        plan: true,
        status: true,
        priceCents: true,
        provider: true,
        startedAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        canceledAt: true,
        trialEndsAt: true,
        user: { select: { id: true, name: true, email: true, handle: true } },
      },
    }),
  ]);

  return {
    linhas: assinaturas.map((assinatura) => ({
      id: assinatura.id,
      usuario: assinatura.user
        ? {
            id: assinatura.user.id,
            nome: assinatura.user.name,
            email: assinatura.user.email,
            handle: assinatura.user.handle,
          }
        : null,
      plano: assinatura.plan,
      status: assinatura.status,
      precoCents:
        assinatura.priceCents ?? PLANOS[assinatura.plan]?.precoCents ?? 0,
      estimado: assinatura.priceCents === null,
      provedor: assinatura.provider,
      inicio: assinatura.startedAt,
      fimDoPeriodo: assinatura.currentPeriodEnd,
      cancelaNoFim: assinatura.cancelAtPeriodEnd,
      canceladaEm: assinatura.canceledAt,
      fimDoTeste: assinatura.trialEndsAt,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}

export type LinhaDePagamento = {
  id: string;
  usuario: { id: string; nome: string; email: string } | null;
  /** Nulo numa compra avulsa: ela nao pertence a plano nenhum. */
  plano: string | null;
  valorCents: number;
  reembolsadoCents: number;
  moeda: string;
  status: string;
  provedor: string | null;
  metodo: string | null;
  falha: string | null;
  demo: boolean;
  quando: Date;
};

export async function listarPagamentos(opcoes: {
  periodo: Periodo;
  status?: string;
  pagina?: number;
  porPagina?: number;
}): Promise<{
  linhas: LinhaDePagamento[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, opcoes.porPagina ?? 25));
  const pagina = Math.max(1, opcoes.pagina ?? 1);

  const onde: Prisma.PaymentWhereInput = {
    createdAt: { gte: opcoes.periodo.inicio, lt: opcoes.periodo.fim },
  };
  const statusValidos = ["PENDING", "APPROVED", "FAILED", "REFUNDED", "CHARGEBACK"];
  if (opcoes.status && statusValidos.includes(opcoes.status)) {
    onde.status = opcoes.status as never;
  }

  const [total, pagamentos] = await Promise.all([
    db.payment.count({ where: onde }),
    db.payment.findMany({
      where: onde,
      orderBy: { createdAt: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);

  // `Payment.userId` não tem relação declarada no schema; resolvido em lote.
  const usuarios = pagamentos.length
    ? await db.user.findMany({
        where: { id: { in: [...new Set(pagamentos.map((p) => p.userId))] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const porId = new Map(usuarios.map((usuario) => [usuario.id, usuario]));

  return {
    linhas: pagamentos.map((pagamento) => {
      const usuario = porId.get(pagamento.userId);
      return {
        id: pagamento.id,
        usuario: usuario
          ? { id: usuario.id, nome: usuario.name, email: usuario.email }
          : null,
        plano: pagamento.plan,
        valorCents: pagamento.amountCents,
        reembolsadoCents: pagamento.refundedCents,
        moeda: pagamento.currency,
        status: pagamento.status,
        provedor: pagamento.provider,
        metodo: pagamento.method,
        falha: pagamento.failureMessage ?? pagamento.failureCode,
        demo: pagamento.isDemo,
        quando: pagamento.createdAt,
      };
    }),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}
