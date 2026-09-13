import { describe, expect, it } from "vitest";

import { fotoDoElenco } from "./fotos-elenco";

describe("fotoDoElenco", () => {
  it("expõe uma foto editorial só pelo slug e pela versão, nunca pela chave do bucket", () => {
    expect(fotoDoElenco("ana-da-silva", "elenco/pessoa-1/foto-123.webp")).toBe(
      "/api/elenco/ana-da-silva/foto/foto-123",
    );
  });

  it("mantém a resolução de imagens que pertencem à camada de arte", () => {
    expect(fotoDoElenco("ana-da-silva", "gen:ator/ana")).toBe(
      "/api/arte/ator/ana",
    );
  });

  it("não gera endereço quando a pessoa ainda não tem foto", () => {
    expect(fotoDoElenco("ana-da-silva", null)).toBeNull();
  });
});
