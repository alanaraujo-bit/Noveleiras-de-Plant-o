/**
 * A situação da renovação que as telas leem.
 *
 * O caso que motivou este arquivo: quando o Pix vence e a carência acaba, a
 * expiração devolve o plano a FREE — como deve. Sem cuidado, a tela passaria a
 * tratá-la como alguém que nunca assinou, e ela não entenderia o que houve.
 * `billingMode` sobrevive ao corte, e é por ele que a tela reconhece a
 * história e diz "Seu Plantão terminou".
 */
import { describe, expect, it } from "vitest";

import { situacaoDaRenovacao } from "./renovacao";

function dia(ano: number, mes: number, d: number): Date {
  return new Date(ano, mes - 1, d, 12);
}

const base = {
  plan: "MONTHLY" as const,
  status: "ACTIVE" as const,
  billingMode: "MANUAL_RENEW" as const,
  currentPeriodEnd: dia(2026, 10, 11),
  graceUntil: dia(2026, 10, 16),
  cancelAtPeriodEnd: false,
};

describe("situação da renovação", () => {
  it("Pix ativo: sem aviso a dar, mas a tela sabe que é Pix", () => {
    const s = situacaoDaRenovacao(base, dia(2026, 9, 20));

    expect(s.manual).toBe(true);
    expect(s.temPlano).toBe(true);
    expect(s.aviso?.momento).toBe("em-dia");
  });

  it("Pix na carência: continua plano, com o prazo de renovar", () => {
    const s = situacaoDaRenovacao(
      { ...base, status: "PAST_DUE" as const },
      dia(2026, 10, 13),
    );

    expect(s.aviso?.momento).toBe("carencia");
    expect(s.renovarAte).toEqual(dia(2026, 10, 16));
  });

  it("Pix que terminou: a tela reconhece, mesmo com o plano já em FREE", () => {
    const s = situacaoDaRenovacao(
      { ...base, plan: "FREE" as const, status: "EXPIRED" as const },
      dia(2026, 10, 20),
    );

    expect(s.manual).toBe(true);
    // Não tem mais plano — isso não muda.
    expect(s.temPlano).toBe(false);
    expect(s.aviso?.momento).toBe("encerrado");
  });

  it("cartão que expirou não vira aviso de Pix", () => {
    const s = situacaoDaRenovacao(
      {
        ...base,
        plan: "FREE" as const,
        status: "EXPIRED" as const,
        billingMode: "AUTO_RENEW" as const,
      },
      dia(2026, 10, 20),
    );

    expect(s.manual).toBe(false);
    expect(s.aviso).toBeNull();
  });

  it("cartão renovando sozinho não recebe lembrete", () => {
    // Não há nada para ela fazer; lembrar seria pedir uma ação inexistente.
    const s = situacaoDaRenovacao(
      { ...base, billingMode: "AUTO_RENEW" as const },
      dia(2026, 10, 10),
    );

    expect(s.aviso).toBeNull();
  });

  it("quem nunca assinou não tem situação nenhuma", () => {
    expect(situacaoDaRenovacao(null).aviso).toBeNull();
  });
});
