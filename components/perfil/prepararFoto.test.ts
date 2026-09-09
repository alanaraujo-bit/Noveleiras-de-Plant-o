import { afterEach, describe, expect, it, vi } from "vitest";

import { prepararFotoPerfil } from "./prepararFoto";

describe("prepararFotoPerfil", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recusa arquivos que não são imagens", async () => {
    const arquivo = new File(["texto"], "nota.txt", { type: "text/plain" });
    await expect(prepararFotoPerfil(arquivo)).rejects.toThrow(
      "Escolha uma imagem",
    );
  });

  it("reduz a maior dimensão e converte a foto para WebP", async () => {
    const fechar = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3000, height: 2000, close: fechar })),
    );
    const desenhar = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: desenhar,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(new Blob(["webp"], { type: "image/webp" })),
    );

    const original = new File(["imagem"], "camera.jpg", {
      type: "image/jpeg",
    });
    const resultado = await prepararFotoPerfil(original);

    expect(resultado.type).toBe("image/webp");
    expect(resultado.name).toBe("foto-perfil.webp");
    expect(desenhar).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1280,
      853,
    );
    expect(fechar).toHaveBeenCalledOnce();
  });
});
