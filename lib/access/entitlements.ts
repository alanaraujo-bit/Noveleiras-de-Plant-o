/**
 * Estados de acesso.
 *
 * A regra vive aqui e é aplicada no servidor, no endpoint que entrega o
 * descritor de mídia — não na interface. A UI só reflete o que este módulo
 * decidiu; bloquear na tela seria decorativo.
 */

import type {
  AccessTier,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";

export type Entitlement = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** Assinatura em vigor agora (inclui período de teste). */
  active: boolean;
  premium: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Quantos episódios premium o visitante pode ver antes do paywall. */
  freePreviewEpisodes: number;
};

export type SubscriptionLike = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
} | null;

export const FREE_PREVIEW_EPISODES = 2;

const LIVE_STATUSES: SubscriptionStatus[] = ["ACTIVE", "TRIALING"];

export function entitlementFrom(sub: SubscriptionLike): Entitlement {
  const plan = sub?.plan ?? "FREE";
  const status = sub?.status ?? "ACTIVE";
  const notExpired =
    !sub?.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now();
  const active = LIVE_STATUSES.includes(status) && notExpired;

  return {
    plan,
    status,
    active,
    premium: active && plan !== "FREE",
    trialEndsAt: sub?.trialEndsAt ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    freePreviewEpisodes: FREE_PREVIEW_EPISODES,
  };
}

export const ANONYMOUS_ENTITLEMENT: Entitlement = entitlementFrom(null);

export type EpisodeAccessInput = {
  accessTier: AccessTier;
  /** Posição do episódio na novela (1-based), para a amostra grátis. */
  episodeIndex: number;
};

export type AccessDecision =
  | { allowed: true; reason: "free" | "preview" | "subscription" }
  | { allowed: false; reason: "needs-subscription" | "needs-account" };

/** Decisão única de acesso a um episódio. Usada pela rota de mídia e pela UI. */
export function canWatchEpisode(
  episode: EpisodeAccessInput,
  entitlement: Entitlement,
  signedIn: boolean,
): AccessDecision {
  if (!signedIn) return { allowed: false, reason: "needs-account" };
  if (episode.accessTier === "FREE") return { allowed: true, reason: "free" };
  if (entitlement.premium) return { allowed: true, reason: "subscription" };
  if (episode.episodeIndex <= entitlement.freePreviewEpisodes) {
    return { allowed: true, reason: "preview" };
  }
  return { allowed: false, reason: "needs-subscription" };
}

export function planLabel(plan: SubscriptionPlan): string {
  switch (plan) {
    case "PREMIUM":
      return "Plantão Premium";
    case "VIP":
      return "Plantão VIP";
    default:
      return "Plantão Gratuito";
  }
}
