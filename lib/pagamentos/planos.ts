/**
 * Tabela comercial.
 *
 * Os preços vivem em código porque preço é decisão de produto e merece
 * revisão de código para mudar. A tabela `Plan` no banco é o espelho disto,
 * reconciliado por `scripts/semear-planos.ts` — ela existe para que uma venda
 * grave *quanto custava no dia*, já que mudar a tabela amanhã não pode
 * reescrever quanto alguém pagou ontem.
 *
 * Regra oficial vigente:
 *   Gratuito  R$   0,00  — os 5 primeiros episódios de cada novela
 *   Mensal    R$   9,99  — catálogo inteiro enquanto estiver ativo
 *   Anual     R$  99,90  — catálogo inteiro por 12 meses
 *   Avulso    R$   4,99  — uma novela, para sempre
 */

import type { EntitlementKind, SubscriptionPlan } from "@prisma/client";

// Caminho relativo, e não o alias `@/`: este módulo é lido também por
// `scripts/semear-planos.ts`, que roda em Node puro e não resolve o alias do
// tsconfig. Mesma restrição que já vale para `lib/media/biblioteca.ts`.
import { EPISODIOS_GRATUITOS } from "../access/entitlements.ts";

export type IntervaloDePlano = "MONTH" | "YEAR";

export type DefinicaoDePlano = {
  code: SubscriptionPlan;
  nome: string;
  descricao: string;
  precoCents: number;
  moeda: string;
  intervalo: IntervaloDePlano;
  intervaloCount: number;
  entitlementKind: EntitlementKind;
  ativo: boolean;
  ordem: number;
  cor: string;
  /** O que a tela de planos lista como incluso. */
  beneficios: string[];
};

/** Preço da compra avulsa de uma novela, quando a obra não define o próprio. */
export const PRECO_AVULSO_CENTS = 499;

export const PLANO_MENSAL: DefinicaoDePlano = {
  code: "MONTHLY",
  nome: "Plantão Mensal",
  descricao: "Catálogo inteiro liberado enquanto a assinatura estiver ativa.",
  precoCents: 999,
  moeda: "BRL",
  intervalo: "MONTH",
  intervaloCount: 1,
  entitlementKind: "SUBSCRIPTION_MONTHLY",
  ativo: true,
  ordem: 1,
  cor: "#e03a69",
  beneficios: [
    "Todas as novelas, todos os episódios",
    "Sem espera entre um capítulo e o outro",
    "Cancela quando quiser, sem multa",
  ],
};

export const PLANO_ANUAL: DefinicaoDePlano = {
  code: "ANNUAL",
  nome: "Plantão Anual",
  descricao: "Catálogo inteiro por 12 meses, com o melhor preço por mês.",
  precoCents: 9990,
  moeda: "BRL",
  intervalo: "YEAR",
  intervaloCount: 1,
  entitlementKind: "SUBSCRIPTION_ANNUAL",
  ativo: true,
  ordem: 2,
  cor: "#d9a355",
  beneficios: [
    "Tudo do mensal, por 12 meses seguidos",
    "Equivale a R$ 8,33 por mês",
    "Dois meses de graça na comparação com o mensal",
  ],
};

export const PLANO_GRATUITO: DefinicaoDePlano = {
  code: "FREE",
  nome: "Plantão Gratuito",
  descricao: `Os ${EPISODIOS_GRATUITOS} primeiros episódios de cada novela, sem pagar nada.`,
  precoCents: 0,
  moeda: "BRL",
  intervalo: "MONTH",
  intervaloCount: 1,
  entitlementKind: "SUBSCRIPTION_MONTHLY",
  ativo: true,
  ordem: 0,
  cor: "#9d7f8b",
  beneficios: [
    `${EPISODIOS_GRATUITOS} episódios de qualquer novela`,
    "Catálogo, busca e comunidade completos",
    "Sem cartão, sem cobrança",
  ],
};

/** Só os planos que se pode comprar. */
export const PLANOS_VENDAVEIS: DefinicaoDePlano[] = [PLANO_MENSAL, PLANO_ANUAL];

/**
 * Todos os planos indexados pelo código do enum.
 *
 * `PREMIUM` e `VIP` são os nomes da Fase 01. Continuam aqui porque há
 * assinaturas gravadas apontando para eles: sumir com a entrada faria o
 * painel quebrar ao renderizar uma assinatura antiga. Não são vendáveis.
 */
export const PLANOS: Record<SubscriptionPlan, DefinicaoDePlano> = {
  FREE: PLANO_GRATUITO,
  MONTHLY: PLANO_MENSAL,
  ANNUAL: PLANO_ANUAL,
  PREMIUM: {
    ...PLANO_MENSAL,
    code: "PREMIUM",
    nome: "Plantão Premium",
    descricao: "Plano da Fase 01, mantido para assinaturas já existentes.",
    precoCents: 1990,
    ativo: false,
    ordem: 90,
  },
  VIP: {
    ...PLANO_ANUAL,
    code: "VIP",
    nome: "Plantão VIP",
    descricao: "Plano da Fase 01, mantido para assinaturas já existentes.",
    precoCents: 3490,
    intervalo: "MONTH",
    ativo: false,
    ordem: 91,
  },
};

export function planoPorCodigo(code: SubscriptionPlan): DefinicaoDePlano {
  return PLANOS[code] ?? PLANO_GRATUITO;
}

/** O plano é comprável hoje? Barra `PREMIUM`/`VIP` e `FREE` no checkout. */
export function ehPlanoVendavel(code: string): code is "MONTHLY" | "ANNUAL" {
  return PLANOS_VENDAVEIS.some((p) => p.code === code);
}

/**
 * Fim do ciclo a partir de um início.
 *
 * Usa aritmética de calendário, não `+30 dias`: quem assina dia 31 de janeiro
 * espera cobrança em fevereiro, e `setMonth` já resolve o mês curto. Somar
 * milissegundos faria a data derivar alguns dias por ano.
 */
export function fimDoCiclo(
  plano: Pick<DefinicaoDePlano, "intervalo" | "intervaloCount">,
  inicio: Date = new Date(),
): Date {
  const fim = new Date(inicio.getTime());

  if (plano.intervalo === "YEAR") {
    fim.setFullYear(fim.getFullYear() + plano.intervaloCount);
  } else {
    fim.setMonth(fim.getMonth() + plano.intervaloCount);
  }

  return fim;
}

/** "R$ 9,99" a partir de centavos. */
export function precoEmReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Quanto o anual economiza em relação a 12 meses do mensal, em centavos. */
export function economiaAnualCents(): number {
  return PLANO_MENSAL.precoCents * 12 - PLANO_ANUAL.precoCents;
}

/** Preço mensal equivalente do anual, para a comparação honesta na tela. */
export function mensalEquivalenteDoAnual(): number {
  return Math.round(PLANO_ANUAL.precoCents / 12);
}
