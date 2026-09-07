import { describe, expect, it } from "vitest";

import {
  formatClock,
  formatCount,
  formatDuration,
  formatMinutes,
  formatRating,
  formatRelative,
  episodeLabel,
} from "./format";

describe("formatClock", () => {
  it("formata como relógio de player", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(67)).toBe("1:07");
    expect(formatClock(724)).toBe("12:04");
  });

  it("não quebra com valores negativos ou fracionários", () => {
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(61.9)).toBe("1:01");
  });
});

describe("formatDuration", () => {
  it("descreve a duração em minutos e segundos", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(118)).toBe("1 min 58s");
  });
});

describe("formatMinutes", () => {
  it("passa a usar horas acima de 60 minutos", () => {
    expect(formatMinutes(21)).toBe("21 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(135)).toBe("2 h 15 min");
  });
});

describe("formatCount", () => {
  it("abrevia com vírgula decimal do português", () => {
    expect(formatCount(842)).toBe("842");
    expect(formatCount(3184)).toBe("3,2 mil");
    expect(formatCount(12440)).toBe("12 mil");
    expect(formatCount(1_400_000)).toBe("1,4 mi");
  });
});

describe("formatRating", () => {
  it("usa vírgula decimal", () => {
    expect(formatRating(4.8)).toBe("4,8");
    expect(formatRating(5)).toBe("5,0");
  });
});

describe("formatRelative", () => {
  it("chama de agora o que acabou de acontecer", () => {
    expect(formatRelative(new Date().toISOString())).toBe("agora");
  });

  it("descreve horas e dias em português", () => {
    const duasHoras = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatRelative(duasHoras)).toContain("hora");

    const ontem = new Date(Date.now() - 26 * 3_600_000).toISOString();
    expect(formatRelative(ontem)).toBe("ontem");
  });

  it("vira data absoluta depois de um mês", () => {
    const antigo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    expect(formatRelative(antigo)).toMatch(/\d{2} de \w+/);
  });
});

describe("episodeLabel", () => {
  it("abrevia temporada e episódio", () => {
    expect(episodeLabel(1, 5)).toBe("T1 · Ep. 5");
  });
});
