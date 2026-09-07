import { describe, expect, it } from "vitest";

import {
  canWatchEpisode,
  entitlementFrom,
  ANONYMOUS_ENTITLEMENT,
  FREE_PREVIEW_EPISODES,
  planLabel,
} from "./entitlements";

const dia = 86_400_000;

describe("entitlementFrom", () => {
  it("trata a ausência de assinatura como plano gratuito ativo", () => {
    const e = entitlementFrom(null);
    expect(e.plan).toBe("FREE");
    expect(e.active).toBe(true);
    expect(e.premium).toBe(false);
  });

  it("reconhece assinatura premium vigente", () => {
    const e = entitlementFrom({
      plan: "PREMIUM",
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 10 * dia),
    });
    expect(e.premium).toBe(true);
  });

  it("período de teste conta como acesso premium", () => {
    const e = entitlementFrom({
      plan: "PREMIUM",
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 3 * dia),
      currentPeriodEnd: new Date(Date.now() + 3 * dia),
    });
    expect(e.premium).toBe(true);
  });

  it("assinatura vencida perde o acesso mesmo com status ativo", () => {
    const e = entitlementFrom({
      plan: "PREMIUM",
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() - dia),
    });
    expect(e.premium).toBe(false);
  });

  it("pagamento em atraso bloqueia o acesso premium", () => {
    const e = entitlementFrom({
      plan: "PREMIUM",
      status: "PAST_DUE",
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 10 * dia),
    });
    expect(e.premium).toBe(false);
  });

  it("cancelada dentro do período pago continua valendo até o fim", () => {
    // Cancelamento agendado mantém `status` ACTIVE até o vencimento.
    const e = entitlementFrom({
      plan: "PREMIUM",
      status: "ACTIVE",
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 2 * dia),
    });
    expect(e.premium).toBe(true);
  });
});

describe("canWatchEpisode", () => {
  const gratuito = entitlementFrom(null);
  const premium = entitlementFrom({
    plan: "PREMIUM",
    status: "ACTIVE",
    trialEndsAt: null,
    currentPeriodEnd: new Date(Date.now() + 10 * dia),
  });

  it("exige conta antes de qualquer coisa", () => {
    const decisao = canWatchEpisode(
      { accessTier: "FREE", episodeIndex: 1 },
      premium,
      false,
    );
    expect(decisao).toEqual({ allowed: false, reason: "needs-account" });
  });

  it("libera episódio gratuito para conta gratuita", () => {
    const decisao = canWatchEpisode(
      { accessTier: "FREE", episodeIndex: 9 },
      gratuito,
      true,
    );
    expect(decisao).toEqual({ allowed: true, reason: "free" });
  });

  it("dá amostra dos primeiros episódios premium a quem não assina", () => {
    for (let i = 1; i <= FREE_PREVIEW_EPISODES; i += 1) {
      const decisao = canWatchEpisode(
        { accessTier: "PREMIUM", episodeIndex: i },
        gratuito,
        true,
      );
      expect(decisao).toEqual({ allowed: true, reason: "preview" });
    }
  });

  it("bloqueia o episódio premium seguinte à amostra", () => {
    const decisao = canWatchEpisode(
      { accessTier: "PREMIUM", episodeIndex: FREE_PREVIEW_EPISODES + 1 },
      gratuito,
      true,
    );
    expect(decisao).toEqual({ allowed: false, reason: "needs-subscription" });
  });

  it("assinante vê qualquer episódio premium", () => {
    const decisao = canWatchEpisode(
      { accessTier: "PREMIUM", episodeIndex: 40 },
      premium,
      true,
    );
    expect(decisao).toEqual({ allowed: true, reason: "subscription" });
  });

  it("visitante anônimo nunca passa, mesmo em episódio gratuito", () => {
    const decisao = canWatchEpisode(
      { accessTier: "FREE", episodeIndex: 1 },
      ANONYMOUS_ENTITLEMENT,
      false,
    );
    expect(decisao.allowed).toBe(false);
  });
});

describe("planLabel", () => {
  it("nomeia os planos em português", () => {
    expect(planLabel("FREE")).toBe("Plantão Gratuito");
    expect(planLabel("PREMIUM")).toBe("Plantão Premium");
    expect(planLabel("VIP")).toBe("Plantão VIP");
  });
});
