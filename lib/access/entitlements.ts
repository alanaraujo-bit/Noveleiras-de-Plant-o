/**
 * Direitos de acesso.
 *
 * Este módulo é a **fonte de verdade** sobre quem pode assistir o quê. Ele é
 * puro de propósito: não abre conexão, não lê cookie, não conhece requisição.
 * Quem carrega os direitos do banco é `lib/access/direitos.ts`; quem aplica é
 * a rota de mídia. A interface só reflete uma decisão já tomada aqui —
 * bloquear na tela seria decorativo.
 *
 * A troca em relação à Fase 01: não existe mais um `premium: boolean` que
 * decide tudo. Uma pessoa pode ter assinatura vencida e ainda assim ver uma
 * novela que comprou avulsa; pode não ter assinatura nenhuma e ver os
 * primeiros episódios de qualquer obra. Um booleano não expressa isso, e
 * tentar espremer essas regras num `isPremium` é exatamente como um paywall
 * começa a vazar.
 */

import type { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

/**
 * Quantos episódios de cada novela qualquer pessoa vê de graça, mesmo sem conta.
 *
 * Regra oficial do produto. Era 2 na Fase 01; virou 5. O número mora aqui e
 * em lugar nenhum mais — textos de tela leem daqui.
 */
export const EPISODIOS_GRATUITOS = 5;

/** Nome antigo, mantido porque testes e telas da Fase 01 o importam. */
export const FREE_PREVIEW_EPISODES = EPISODIOS_GRATUITOS;

export type TipoDeDireito =
  | "SUBSCRIPTION_MONTHLY"
  | "SUBSCRIPTION_ANNUAL"
  | "TITLE_PURCHASE";

/**
 * Um direito já validado — carregado do banco e filtrado por vigência.
 *
 * `endsAt` nulo significa perpétuo, que é o caso da compra avulsa: continua
 * valendo para episódios publicados depois da compra.
 */
export type Direito = {
  kind: TipoDeDireito;
  novelaId: string | null;
  startsAt: Date;
  endsAt: Date | null;
};

export type AssinaturaLike = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Tolerância após falha de cobrança: o acesso sobrevive até aqui. */
  graceUntil?: Date | null;
} | null;

/**
 * A carteira de direitos de uma pessoa, no instante da consulta.
 *
 * Nome antigo do tipo (`Entitlement`) preservado porque `Viewer` e várias
 * telas o importam; o conteúdo é que deixou de ser um booleano.
 */
export type Entitlement = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** Assinatura em vigor agora (inclui teste e tolerância). */
  active: boolean;
  /**
   * Acesso irrestrito ao catálogo por assinatura.
   *
   * Sobrevive como campo derivado porque a UI pergunta isso o tempo todo —
   * mas **nunca** é o que autoriza um episódio. Quem autoriza é
   * `canWatchEpisode`, que também olha compras avulsas.
   */
  premium: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Novelas compradas avulso, permanentes. */
  titulosComprados: string[];
  /** Episódios liberados por novela para quem não assina. */
  freePreviewEpisodes: number;
};

// PAST_DUE está aqui de propósito: cobrança em atraso não corta acesso na
// hora. `vigente()` ainda exige `currentPeriodEnd` ou `graceUntil` no futuro,
// então o acesso dura o ciclo pago mais a tolerância — e acaba por data, não
// no instante em que o provedor recusa ou pausa.
const STATUS_VIVOS: SubscriptionStatus[] = ["ACTIVE", "TRIALING", "PAST_DUE"];

/** Planos que dão catálogo inteiro. Inclui os nomes legados da Fase 01. */
const PLANOS_ILIMITADOS: SubscriptionPlan[] = [
  "MONTHLY",
  "ANNUAL",
  "PREMIUM",
  "VIP",
];

function vigente(sub: NonNullable<AssinaturaLike>, agora: number): boolean {
  if (!STATUS_VIVOS.includes(sub.status)) return false;
  if (!sub.currentPeriodEnd) return true;
  if (sub.currentPeriodEnd.getTime() > agora) return true;
  // Cobrança falhou mas ainda estamos na tolerância combinada: o acesso não
  // cai no primeiro erro de cartão.
  return Boolean(sub.graceUntil && sub.graceUntil.getTime() > agora);
}

/**
 * Monta a carteira a partir da assinatura e dos direitos carregados.
 *
 * `direitos` chega já filtrado pelo banco (status ACTIVE). A revalidação de
 * data aqui é de propósito: uma linha marcada ACTIVE cuja `endsAt` já passou
 * — porque o job de expiração ainda não rodou — não pode liberar nada.
 */
export function carteiraDe(
  sub: AssinaturaLike,
  direitos: Direito[] = [],
  agora: Date = new Date(),
): Entitlement {
  const t = agora.getTime();
  const plan = sub?.plan ?? "FREE";
  const status = sub?.status ?? "ACTIVE";
  const active = sub ? vigente(sub, t) : true;

  const validos = direitos.filter(
    (d) =>
      d.startsAt.getTime() <= t && (!d.endsAt || d.endsAt.getTime() > t),
  );

  const assinaturaPorDireito = validos.some(
    (d) => d.kind === "SUBSCRIPTION_MONTHLY" || d.kind === "SUBSCRIPTION_ANNUAL",
  );

  return {
    plan,
    status,
    active,
    // Duas origens porque as assinaturas da Fase 01 não têm linha em
    // `Entitlement`. A tabela manda quando existe; a assinatura cobre o legado.
    premium:
      assinaturaPorDireito ||
      (active && PLANOS_ILIMITADOS.includes(plan)),
    trialEndsAt: sub?.trialEndsAt ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    titulosComprados: validos
      .filter((d) => d.kind === "TITLE_PURCHASE" && d.novelaId)
      .map((d) => d.novelaId as string),
    freePreviewEpisodes: EPISODIOS_GRATUITOS,
  };
}

/** Nome antigo. Assinatura sem direitos carregados — usado no legado. */
export function entitlementFrom(sub: AssinaturaLike): Entitlement {
  return carteiraDe(sub, []);
}

export const ANONYMOUS_ENTITLEMENT: Entitlement = carteiraDe(null, []);

export type EpisodeAccessInput = {
  /** A que obra o episódio pertence — a compra avulsa é por obra. */
  novelaId: string;
  /** Posição do episódio na novela (1-based). */
  episodeIndex: number;
  /** Obra liberada inteira de propósito (promoção editorial). */
  openAccess?: boolean;
};

export type MotivoLiberado =
  | "aberta"
  | "gratuito"
  | "assinatura"
  | "compra";

export type MotivoBloqueado = "precisa-conta" | "precisa-pagar";

export type AccessDecision =
  | { allowed: true; reason: MotivoLiberado }
  | { allowed: false; reason: MotivoBloqueado };

/**
 * A decisão. Único lugar onde a regra comercial vira sim ou não.
 *
 * A ordem importa e não é arbitrária: o caminho mais barato e mais permissivo
 * vem primeiro, para que uma consulta de direitos que falhe não transforme
 * episódio gratuito em episódio bloqueado.
 */
export function canWatchEpisode(
  episode: EpisodeAccessInput,
  entitlement: Entitlement,
  signedIn: boolean,
): AccessDecision {
  if (episode.openAccess) return { allowed: true, reason: "aberta" };

  // A regra do produto: os N primeiros de qualquer novela, para qualquer
  // pessoa, incluindo visitantes. Não depende de plano nem de `accessTier`.
  if (episode.episodeIndex <= entitlement.freePreviewEpisodes) {
    return { allowed: true, reason: "gratuito" };
  }

  if (!signedIn) return { allowed: false, reason: "precisa-conta" };

  if (entitlement.premium) return { allowed: true, reason: "assinatura" };

  if (entitlement.titulosComprados.includes(episode.novelaId)) {
    return { allowed: true, reason: "compra" };
  }

  return { allowed: false, reason: "precisa-pagar" };
}

/** A obra inteira está liberada? Usado para o CTA da página da novela. */
export function temNovelaCompleta(
  novelaId: string,
  entitlement: Entitlement,
  openAccess = false,
): boolean {
  return (
    openAccess ||
    entitlement.premium ||
    entitlement.titulosComprados.includes(novelaId)
  );
}

export function planLabel(plan: SubscriptionPlan): string {
  switch (plan) {
    case "MONTHLY":
      return "Plantão Mensal";
    case "ANNUAL":
      return "Plantão Anual";
    // Nomes da Fase 01, ainda gravados em assinaturas antigas.
    case "PREMIUM":
      return "Plantão Premium";
    case "VIP":
      return "Plantão VIP";
    default:
      return "Plantão Gratuito";
  }
}
