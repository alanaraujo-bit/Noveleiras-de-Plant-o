import { describe, expect, it } from "vitest";

import {
  baldesDoPeriodo,
  chaveDoDia,
  inicioDoDia,
  instanteDoFuso,
  resolverPeriodo,
  somarDias,
} from "./tempo";

/**
 * O que estes testes protegem: a diferença entre o dia de Brasília e o dia
 * UTC. Entre 21h e 0h em São Paulo o UTC já virou — se "hoje" for calculado em
 * UTC, o painel mostra as três horas erradas e ninguém entende o degrau no
 * gráfico.
 */

describe("dia no fuso da operação", () => {
  it("às 22h de São Paulo ainda é o mesmo dia, mesmo com o UTC já virado", () => {
    // 2026-09-07 22:30 em São Paulo = 2026-09-08 01:30 UTC.
    const instante = new Date("2026-09-08T01:30:00.000Z");
    expect(chaveDoDia(instante)).toBe("2026-09-07");
    expect(inicioDoDia(instante).toISOString()).toBe("2026-09-07T03:00:00.000Z");
  });

  it("à meia-noite e um de São Paulo já é o dia seguinte", () => {
    const instante = new Date("2026-09-08T03:01:00.000Z");
    expect(chaveDoDia(instante)).toBe("2026-09-08");
  });

  it("converte data local em instante UTC com o deslocamento do Brasil", () => {
    expect(instanteDoFuso(2026, 9, 7).toISOString()).toBe(
      "2026-09-07T03:00:00.000Z",
    );
  });

  it("somar dias atravessa a virada do mês", () => {
    expect(chaveDoDia(somarDias(instanteDoFuso(2026, 8, 31), 1))).toBe(
      "2026-09-01",
    );
  });
});

describe("períodos", () => {
  const agora = new Date("2026-09-08T01:30:00.000Z"); // 07/09 22h30 em SP

  it("hoje começa à meia-noite de São Paulo e termina na próxima", () => {
    const periodo = resolverPeriodo("hoje", { agora });
    expect(periodo.inicio.toISOString()).toBe("2026-09-07T03:00:00.000Z");
    expect(periodo.fim.toISOString()).toBe("2026-09-08T03:00:00.000Z");
    expect(periodo.granularidade).toBe("hora");
  });

  it("a janela anterior tem a mesma duração e encosta na atual", () => {
    const periodo = resolverPeriodo("7d", { agora });
    expect(periodo.anterior.fim).toEqual(periodo.inicio);
    expect(periodo.fim.getTime() - periodo.inicio.getTime()).toBe(
      periodo.anterior.fim.getTime() - periodo.anterior.inicio.getTime(),
    );
  });

  it("7 dias cobre sete dias inteiros, incluindo hoje", () => {
    const periodo = resolverPeriodo("7d", { agora });
    expect(baldesDoPeriodo(periodo)).toHaveLength(7);
    expect(baldesDoPeriodo(periodo)[0].chave).toBe("2026-09-01");
    expect(baldesDoPeriodo(periodo)[6].chave).toBe("2026-09-07");
  });

  it("período personalizado trata a data final como inclusiva", () => {
    const periodo = resolverPeriodo("personalizado", {
      agora,
      de: "2026-09-01",
      ate: "2026-09-03",
    });
    expect(baldesDoPeriodo(periodo).map((b) => b.chave)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("período personalizado inválido cai no padrão em vez de quebrar", () => {
    const periodo = resolverPeriodo("personalizado", {
      agora,
      de: "2026-09-10",
      ate: "2026-09-01",
    });
    expect(periodo.chave).toBe("30d");
  });

  it("hoje rende 24 baldes de hora", () => {
    expect(baldesDoPeriodo(resolverPeriodo("hoje", { agora }))).toHaveLength(24);
  });

  it("12 meses agrupa por mês", () => {
    const periodo = resolverPeriodo("12m", { agora });
    expect(periodo.granularidade).toBe("mes");
    expect(baldesDoPeriodo(periodo).at(-1)?.chave).toBe("2026-09");
  });
});
