import { describe, expect, it } from "vitest";

import { normalizeText, slugify, initials } from "./text";

describe("normalizeText", () => {
  it("remove acentos sem quebrar a palavra", () => {
    expect(normalizeText("Coração em Plantão")).toBe("coracao em plantao");
    expect(normalizeText("Herdeira do Silêncio")).toBe("herdeira do silencio");
    expect(normalizeText("Véspera de Noiva")).toBe("vespera de noiva");
    expect(normalizeText("Ação, à vontade")).toBe("acao a vontade");
  });

  it("é o que faz a busca sem acento funcionar nos dois sentidos", () => {
    expect(normalizeText("coracao")).toBe(normalizeText("Coração"));
    expect(normalizeText("VINGANCA")).toBe(normalizeText("vingança"));
  });

  it("descarta pontuação e junta espaços", () => {
    expect(normalizeText("  Sete   Dias, de  Fevereiro!  ")).toBe(
      "sete dias de fevereiro",
    );
  });

  it("preserva números", () => {
    expect(normalizeText("Novela 2026")).toBe("novela 2026");
  });

  it("devolve string vazia para entrada só de símbolos", () => {
    expect(normalizeText("!!!???")).toBe("");
  });
});

describe("slugify", () => {
  it("gera slug legível", () => {
    expect(slugify("Herdeira do Silêncio")).toBe("herdeira-do-silencio");
    expect(slugify("A Noiva de Aluguel")).toBe("a-noiva-de-aluguel");
  });
});

describe("initials", () => {
  it("usa no máximo duas iniciais", () => {
    expect(initials("Rosana Piedade")).toBe("RP");
    expect(initials("Alan")).toBe("A");
    expect(initials("Maria da Silva Santos")).toBe("MD");
  });
});
