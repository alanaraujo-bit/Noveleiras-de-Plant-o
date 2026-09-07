import type { SubscriptionPlan } from "@prisma/client";

/**
 * Catálogo de planos.
 *
 * Por que existe: a Fase 01 gravou `Subscription.priceCents` como nulo em
 * quase toda assinatura. Sem um preço de referência, receita e MRR seriam
 * literalmente inderiváveis — e a saída fácil (inventar um número) é o que
 * esta fase se recusa a fazer.
 *
 * A regra que adotamos: **o preço registrado na assinatura sempre vence**.
 * O catálogo só entra quando não há preço gravado, e nesse caso o painel diz
 * em tela quantas assinaturas estão sendo estimadas. Assim o número é útil
 * hoje e vira exato sozinho no dia em que um provedor de pagamento real
 * carimbar `priceCents` em cada cobrança.
 *
 * Fica em código, e não em tabela, porque preço é decisão de produto e precisa
 * de revisão de código para mudar. Plano novo é uma entrada aqui mais um valor
 * no enum — nenhuma tela muda.
 */

export type DefinicaoDePlano = {
  plano: SubscriptionPlan;
  nome: string;
  /** Preço mensal de tabela, em centavos. */
  precoCents: number;
  descricao: string;
  cor: string;
};

export const PLANOS: Record<SubscriptionPlan, DefinicaoDePlano> = {
  FREE: {
    plano: "FREE",
    nome: "Plantão Gratuito",
    precoCents: 0,
    descricao: "Catálogo aberto e os dois primeiros episódios de cada premium.",
    cor: "#9d7f8b",
  },
  PREMIUM: {
    plano: "PREMIUM",
    nome: "Plantão Premium",
    precoCents: 1990,
    descricao: "Catálogo completo, sem limite de episódios.",
    cor: "#e03a69",
  },
  VIP: {
    plano: "VIP",
    nome: "Plantão VIP",
    precoCents: 3490,
    descricao: "Tudo do Premium mais lançamentos antecipados.",
    cor: "#d9a355",
  },
};

export const PLANOS_PAGOS: SubscriptionPlan[] = ["PREMIUM", "VIP"];

/** Preço mensal de uma assinatura. `registrado` diz se veio do fato ou do catálogo. */
export function precoMensal(assinatura: {
  plan: SubscriptionPlan;
  priceCents: number | null;
}): { cents: number; registrado: boolean } {
  if (assinatura.priceCents != null) {
    return { cents: assinatura.priceCents, registrado: true };
  }
  return { cents: PLANOS[assinatura.plan].precoCents, registrado: false };
}

/**
 * Receita recorrente mensal.
 *
 * Devolve, junto do valor, quantas assinaturas tiveram o preço estimado —
 * o painel mostra isso ao lado do número. Um MRR com asterisco visível é
 * honesto; um MRR redondo sem contexto, não.
 */
export function calcularMrr(
  assinaturas: { plan: SubscriptionPlan; priceCents: number | null }[],
): { cents: number; total: number; estimadas: number; centsEstimados: number } {
  let cents = 0;
  let estimadas = 0;
  let centsEstimados = 0;

  for (const assinatura of assinaturas) {
    if (assinatura.plan === "FREE") continue;
    const preco = precoMensal(assinatura);
    cents += preco.cents;
    if (!preco.registrado) {
      estimadas += 1;
      centsEstimados += preco.cents;
    }
  }

  return { cents, total: assinaturas.length, estimadas, centsEstimados };
}
