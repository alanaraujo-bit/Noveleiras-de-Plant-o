/**
 * Planos, na visão do painel.
 *
 * A tabela comercial em si mudou de casa: mora em `lib/pagamentos/planos.ts`,
 * junto do resto da camada de cobrança. Este arquivo virou o adaptador que o
 * painel consome — mantido porque várias telas de métricas o importam, e
 * porque a pergunta que ele responde ("quanto isto vale por mês?") é de
 * relatório, não de venda.
 *
 * A regra de sempre continua valendo: **o preço registrado na assinatura
 * vence**. O catálogo só entra quando não há preço gravado, e o painel diz em
 * tela quantas assinaturas estão sendo estimadas.
 */

import type { SubscriptionPlan } from "@prisma/client";

import {
  PLANOS as CATALOGO,
  planoPorCodigo,
  type DefinicaoDePlano as DefinicaoComercial,
} from "@/lib/pagamentos/planos";

export type DefinicaoDePlano = {
  plano: SubscriptionPlan;
  nome: string;
  /** Preço de tabela do ciclo inteiro, em centavos. */
  precoCents: number;
  descricao: string;
  cor: string;
};

function adaptar(d: DefinicaoComercial): DefinicaoDePlano {
  return {
    plano: d.code,
    nome: d.nome,
    precoCents: d.precoCents,
    descricao: d.descricao,
    cor: d.cor,
  };
}

export const PLANOS: Record<SubscriptionPlan, DefinicaoDePlano> = {
  FREE: adaptar(CATALOGO.FREE),
  MONTHLY: adaptar(CATALOGO.MONTHLY),
  ANNUAL: adaptar(CATALOGO.ANNUAL),
  PREMIUM: adaptar(CATALOGO.PREMIUM),
  VIP: adaptar(CATALOGO.VIP),
};

/** Planos que geram receita. Inclui os nomes legados da Fase 01. */
export const PLANOS_PAGOS: SubscriptionPlan[] = [
  "MONTHLY",
  "ANNUAL",
  "PREMIUM",
  "VIP",
];

/**
 * Quantos meses cada ciclo cobre.
 *
 * Existe porque somar R$ 99,90 de um anual ao MRR inflaria a receita
 * recorrente em doze vezes num único mês. O anual entra como R$ 8,32/mês, que
 * é o que ele de fato representa.
 */
function mesesDoCiclo(plan: SubscriptionPlan): number {
  const d = planoPorCodigo(plan);
  return d.intervalo === "YEAR" ? 12 * d.intervaloCount : d.intervaloCount;
}

/** Preço mensal de uma assinatura. `registrado` diz se veio do fato ou do catálogo. */
export function precoMensal(assinatura: {
  plan: SubscriptionPlan;
  priceCents: number | null;
}): { cents: number; registrado: boolean } {
  const meses = mesesDoCiclo(assinatura.plan);

  if (assinatura.priceCents != null) {
    return { cents: Math.round(assinatura.priceCents / meses), registrado: true };
  }

  return {
    cents: Math.round(PLANOS[assinatura.plan].precoCents / meses),
    registrado: false,
  };
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
