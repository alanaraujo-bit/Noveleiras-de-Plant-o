import { describe, expect, it } from "vitest";

import { proximoFechamento, ultimaJanelaFechada } from "./janelas";

/**
 * O que estes testes protegem: "não pode ficar repetindo". A chave da janela
 * precisa ser a mesma durante toda a janela seguinte — se ela mudasse com o
 * minuto, cada passagem do agendador acharia que há um relatório novo.
 */

// 2026-09-14 10:30 em São Paulo = 13:30 UTC (segunda-feira).
const SEGUNDA_10H30 = new Date("2026-09-14T13:30:00.000Z");

describe("relatório diário", () => {
  it("fecha às 8h de Brasília e cobre as 24 horas anteriores", () => {
    const j = ultimaJanelaFechada("diario", 8, SEGUNDA_10H30);
    expect(j.fim.toISOString()).toBe("2026-09-14T11:00:00.000Z");
    expect(j.inicio.toISOString()).toBe("2026-09-13T11:00:00.000Z");
    expect(j.chave).toBe("diario:2026-09-13T08");
  });

  it("antes das 8h a última janela fechada ainda é a de ontem", () => {
    const seteDaManha = new Date("2026-09-14T10:00:00.000Z"); // 07:00 SP
    const j = ultimaJanelaFechada("diario", 8, seteDaManha);
    expect(j.chave).toBe("diario:2026-09-12T08");
  });

  it("a chave não muda ao longo do dia — o relatório sai uma vez", () => {
    const cedo = ultimaJanelaFechada("diario", 8, new Date("2026-09-14T11:01:00.000Z"));
    const tarde = ultimaJanelaFechada("diario", 8, new Date("2026-09-15T10:59:00.000Z"));
    expect(cedo.chave).toBe(tarde.chave);
  });

  it("às 22h de Brasília (UTC já virou) continua no dia certo", () => {
    const j = ultimaJanelaFechada("diario", 8, new Date("2026-09-15T01:00:00.000Z"));
    expect(j.chave).toBe("diario:2026-09-13T08");
  });
});

describe("intervalos em horas", () => {
  it("6 h alinhado à hora escolhida: fecha às 2h, 8h, 14h e 20h", () => {
    const j = ultimaJanelaFechada("6h", 8, SEGUNDA_10H30);
    expect(j.inicio.toISOString()).toBe("2026-09-14T05:00:00.000Z"); // 02:00 SP
    expect(j.fim.toISOString()).toBe("2026-09-14T11:00:00.000Z"); // 08:00 SP
  });

  it("de hora em hora pega a hora cheia anterior", () => {
    const j = ultimaJanelaFechada("1h", 0, SEGUNDA_10H30);
    expect(j.inicio.toISOString()).toBe("2026-09-14T12:00:00.000Z");
    expect(j.fim.toISOString()).toBe("2026-09-14T13:00:00.000Z");
  });

  it("próximo fechamento é o fim da janela atual mais um passo", () => {
    expect(proximoFechamento("12h", 8, SEGUNDA_10H30).toISOString()).toBe(
      "2026-09-14T23:00:00.000Z", // 20:00 SP
    );
  });
});

describe("relatório semanal", () => {
  it("fecha na segunda-feira e cobre a semana anterior", () => {
    const j = ultimaJanelaFechada("semanal", 8, SEGUNDA_10H30);
    expect(j.fim.toISOString()).toBe("2026-09-14T11:00:00.000Z");
    expect(j.inicio.toISOString()).toBe("2026-09-07T11:00:00.000Z");
  });

  it("no domingo a última semana fechada é a da segunda anterior", () => {
    const domingo = new Date("2026-09-20T15:00:00.000Z");
    const j = ultimaJanelaFechada("semanal", 8, domingo);
    expect(j.fim.toISOString()).toBe("2026-09-14T11:00:00.000Z");
  });
});
