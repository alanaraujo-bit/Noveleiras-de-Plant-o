import { describe, expect, it } from "vitest";

import { foiBloqueioDeAutoplay, pontoDeExtensao } from "./estado-reel";

const item = (episodio: string, novela = "a", bloqueio: string | null = null) => ({
  episodio: { id: episodio },
  novela: { id: novela },
  bloqueio,
});

describe("continuidade do reel", () => {
  it("estende depois do ultimo capitulo ja carregado da novela atual", () => {
    const fila = [item("a1"), item("a2"), item("a3"), item("b1", "b")];
    expect(pontoDeExtensao(fila, 1)).toEqual({ ancora: fila[2], indice: 2 });
  });

  it("nao atravessa o bloqueio que encerra a amostra gratuita", () => {
    const fila = [item("a4"), item("a5"), item("a6", "a", "LOGIN_REQUIRED"), item("b1", "b")];
    expect(pontoDeExtensao(fila, 0)).toBeNull();
  });
});

describe("audio do reel", () => {
  it("rebaixa para mudo apenas quando o navegador bloqueia autoplay", () => {
    expect(foiBloqueioDeAutoplay({ name: "NotAllowedError" })).toBe(true);
    expect(foiBloqueioDeAutoplay({ name: "AbortError" })).toBe(false);
    expect(foiBloqueioDeAutoplay(new Error("rede instavel"))).toBe(false);
  });
});
