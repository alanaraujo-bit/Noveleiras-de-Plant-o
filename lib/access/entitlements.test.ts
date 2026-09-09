import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_ENTITLEMENT,
  canWatchEpisode,
  carteiraDe,
  entitlementFrom,
  EPISODIOS_GRATUITOS,
  planLabel,
  temNovelaCompleta,
  type Direito,
  type Entitlement,
} from "./entitlements";

const dia = 86_400_000;
const NOVELA = "novela-1";
const OUTRA = "novela-2";

function daqui(dias: number): Date {
  return new Date(Date.now() + dias * dia);
}

function assinaturaMensal(fim: Date): Direito {
  return {
    kind: "SUBSCRIPTION_MONTHLY",
    novelaId: null,
    startsAt: new Date(Date.now() - dia),
    endsAt: fim,
  };
}

function compraDe(novelaId: string): Direito {
  return {
    kind: "TITLE_PURCHASE",
    novelaId,
    startsAt: new Date(Date.now() - dia),
    endsAt: null,
  };
}

function episodio(indice: number, novelaId = NOVELA) {
  return { novelaId, episodeIndex: indice };
}

describe("carteiraDe", () => {
  it("trata a ausência de assinatura como plano gratuito", () => {
    const c = carteiraDe(null, []);
    expect(c.plan).toBe("FREE");
    expect(c.premium).toBe(false);
    expect(c.titulosComprados).toEqual([]);
    expect(c.freePreviewEpisodes).toBe(EPISODIOS_GRATUITOS);
  });

  it("reconhece assinatura mensal vigente", () => {
    const c = carteiraDe(
      {
        plan: "MONTHLY",
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEnd: daqui(10),
      },
      [assinaturaMensal(daqui(10))],
    );
    expect(c.premium).toBe(true);
  });

  it("período de teste conta como acesso", () => {
    const c = carteiraDe(
      {
        plan: "MONTHLY",
        status: "TRIALING",
        trialEndsAt: daqui(3),
        currentPeriodEnd: daqui(3),
      },
      [],
    );
    expect(c.premium).toBe(true);
  });

  it("assinatura vencida perde o acesso mesmo com status ativo", () => {
    const c = carteiraDe(
      {
        plan: "ANNUAL",
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEnd: new Date(Date.now() - dia),
      },
      [],
    );
    expect(c.premium).toBe(false);
  });

  it("tolerância após falha de cobrança segura o acesso", () => {
    const c = carteiraDe(
      {
        plan: "MONTHLY",
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEnd: new Date(Date.now() - dia),
        graceUntil: daqui(2),
      },
      [],
    );
    expect(c.premium).toBe(true);
  });

  it("direito marcado ativo mas com prazo vencido não vale", () => {
    // O job de expiração pode não ter rodado ainda; a leitura não pode confiar
    // apenas no status gravado.
    const c = carteiraDe(null, [
      {
        kind: "SUBSCRIPTION_MONTHLY",
        novelaId: null,
        startsAt: new Date(Date.now() - 10 * dia),
        endsAt: new Date(Date.now() - dia),
      },
    ]);
    expect(c.premium).toBe(false);
  });

  it("planos legados da Fase 01 continuam valendo", () => {
    const c = carteiraDe(
      {
        plan: "PREMIUM",
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEnd: daqui(5),
      },
      [],
    );
    expect(c.premium).toBe(true);
  });

  it("lista as novelas compradas", () => {
    const c = carteiraDe(null, [compraDe(NOVELA), compraDe(OUTRA)]);
    expect(c.titulosComprados).toEqual([NOVELA, OUTRA]);
  });
});

describe("canWatchEpisode: a regra dos episódios gratuitos", () => {
  const gratuito = carteiraDe(null, []);

  it(`libera exatamente os ${EPISODIOS_GRATUITOS} primeiros`, () => {
    for (let i = 1; i <= EPISODIOS_GRATUITOS; i += 1) {
      expect(canWatchEpisode(episodio(i), gratuito, true)).toEqual({
        allowed: true,
        reason: "gratuito",
      });
    }
  });

  it(`bloqueia a partir do episódio ${EPISODIOS_GRATUITOS + 1}`, () => {
    expect(
      canWatchEpisode(episodio(EPISODIOS_GRATUITOS + 1), gratuito, true),
    ).toEqual({ allowed: false, reason: "precisa-pagar" });
  });

  it("a regra vale para qualquer novela, não só as marcadas premium", () => {
    // A Fase 01 decidia por `accessTier`, e todo o catálogo estava como FREE.
    // Se aquela porta continuasse aberta, o paywall não fecharia nada.
    expect(canWatchEpisode(episodio(99, OUTRA), gratuito, true).allowed).toBe(
      false,
    );
  });

  it("visitante sem conta não assiste nem o primeiro", () => {
    expect(canWatchEpisode(episodio(1), ANONYMOUS_ENTITLEMENT, false)).toEqual({
      allowed: false,
      reason: "precisa-conta",
    });
  });

  it("obra aberta de propósito libera tudo", () => {
    expect(
      canWatchEpisode(
        { ...episodio(500), openAccess: true },
        gratuito,
        true,
      ),
    ).toEqual({ allowed: true, reason: "aberta" });
  });
});

describe("canWatchEpisode: assinatura e compra", () => {
  it("assinante vê qualquer episódio", () => {
    const c = carteiraDe(
      {
        plan: "ANNUAL",
        status: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEnd: daqui(300),
      },
      [],
    );
    expect(canWatchEpisode(episodio(700), c, true)).toEqual({
      allowed: true,
      reason: "assinatura",
    });
  });

  it("compra avulsa libera a novela inteira", () => {
    const c = carteiraDe(null, [compraDe(NOVELA)]);
    expect(canWatchEpisode(episodio(700, NOVELA), c, true)).toEqual({
      allowed: true,
      reason: "compra",
    });
  });

  it("compra de uma novela não libera outra", () => {
    const c = carteiraDe(null, [compraDe(NOVELA)]);
    expect(canWatchEpisode(episodio(700, OUTRA), c, true)).toEqual({
      allowed: false,
      reason: "precisa-pagar",
    });
  });

  it("assinatura expirada mantém a novela comprada", () => {
    // A exigência mais delicada do produto: cancelar não pode tirar o que já
    // foi pago em separado.
    const c = carteiraDe(
      {
        plan: "MONTHLY",
        status: "EXPIRED",
        trialEndsAt: null,
        currentPeriodEnd: new Date(Date.now() - 30 * dia),
      },
      [compraDe(NOVELA)],
    );

    expect(c.premium).toBe(false);
    expect(canWatchEpisode(episodio(700, NOVELA), c, true).allowed).toBe(true);
    expect(canWatchEpisode(episodio(700, OUTRA), c, true).allowed).toBe(false);
    // E os gratuitos seguem abertos em todo o catálogo.
    expect(canWatchEpisode(episodio(1, OUTRA), c, true).allowed).toBe(true);
  });

  it("compra continua valendo para episódio publicado depois", () => {
    // `endsAt` nulo é o que garante isto: um episódio 800 lançado amanhã cai
    // sob o mesmo direito, sem nenhuma migração de dado.
    const c = carteiraDe(null, [compraDe(NOVELA)]);
    expect(canWatchEpisode(episodio(800, NOVELA), c, true).allowed).toBe(true);
  });
});

describe("temNovelaCompleta", () => {
  const vazia: Entitlement = carteiraDe(null, []);

  it("é falso no plano gratuito", () => {
    expect(temNovelaCompleta(NOVELA, vazia)).toBe(false);
  });

  it("é verdadeiro para quem comprou", () => {
    expect(
      temNovelaCompleta(NOVELA, carteiraDe(null, [compraDe(NOVELA)])),
    ).toBe(true);
  });

  it("é verdadeiro em obra aberta", () => {
    expect(temNovelaCompleta(NOVELA, vazia, true)).toBe(true);
  });
});

describe("planLabel", () => {
  it("nomeia os planos atuais e os legados", () => {
    expect(planLabel("FREE")).toBe("Plantão Gratuito");
    expect(planLabel("MONTHLY")).toBe("Plantão Mensal");
    expect(planLabel("ANNUAL")).toBe("Plantão Anual");
    expect(planLabel("PREMIUM")).toBe("Plantão Premium");
  });
});

describe("entitlementFrom (compatibilidade)", () => {
  it("segue funcionando sem direitos carregados", () => {
    const e = entitlementFrom(null);
    expect(e.plan).toBe("FREE");
    expect(e.titulosComprados).toEqual([]);
  });
});
