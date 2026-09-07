import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveMedia, posterUrl, isGeneratedArt } from "./resolver";

const ambienteOriginal = { ...process.env };

afterEach(() => {
  process.env = { ...ambienteOriginal };
});

describe("resolveMedia", () => {
  it("monta a URL a partir da base configurada", () => {
    process.env.MEDIA_BASE_URL = "/media";
    const fonte = resolveMedia({
      mediaKey: "demo/novela/s1e1.mp4",
      provider: "LOCAL",
    });
    expect(fonte.url).toBe("/media/demo/novela/s1e1.mp4");
    expect(fonte.kind).toBe("mp4");
  });

  it("troca a origem só mudando a variável de ambiente", () => {
    // É este o contrato do produto: migrar do computador de casa para uma CDN
    // não deve exigir mudança de código nem de dados.
    process.env.MEDIA_BASE_URL = "https://cdn.exemplo.com/vod";
    const fonte = resolveMedia({
      mediaKey: "demo/novela/s1e1.mp4",
      provider: "CDN",
    });
    expect(fonte.url).toBe("https://cdn.exemplo.com/vod/demo/novela/s1e1.mp4");
    expect(fonte.provider).toBe("CDN");
  });

  it("não duplica barras entre base e chave", () => {
    process.env.MEDIA_BASE_URL = "https://cdn.exemplo.com/vod/";
    const fonte = resolveMedia({ mediaKey: "/demo/a.mp4" });
    expect(fonte.url).toBe("https://cdn.exemplo.com/vod/demo/a.mp4");
  });

  it("respeita chave que já é uma URL absoluta", () => {
    process.env.MEDIA_BASE_URL = "/media";
    const fonte = resolveMedia({
      mediaKey: "https://outro.exemplo.com/x.mp4",
      provider: "EXTERNAL",
    });
    expect(fonte.url).toBe("https://outro.exemplo.com/x.mp4");
  });

  it("identifica HLS pelo formato", () => {
    expect(resolveMedia({ mediaKey: "a", format: "hls" }).kind).toBe("hls");
    expect(resolveMedia({ mediaKey: "a", format: "m3u8" }).kind).toBe("hls");
    expect(resolveMedia({ mediaKey: "a", format: "mp4" }).kind).toBe("mp4");
  });

  it("devolve a duração e o cartaz quando informados", () => {
    const fonte = resolveMedia({
      mediaKey: "a.mp4",
      thumbKey: "gen:cena/novela/1-1",
      durationSec: 118,
    });
    expect(fonte.durationSec).toBe(118);
    expect(fonte.poster).toBe("/api/arte/cena/novela/1-1");
  });
});

describe("posterUrl", () => {
  beforeEach(() => {
    process.env.MEDIA_BASE_URL = "/media";
  });

  it("encaminha chaves geradas para a rota de arte", () => {
    expect(posterUrl("gen:capa/minha-novela")).toBe("/api/arte/capa/minha-novela");
  });

  it("mantém URLs absolutas intactas", () => {
    expect(posterUrl("https://img.exemplo.com/a.jpg")).toBe(
      "https://img.exemplo.com/a.jpg",
    );
  });

  it("resolve arte real pela base de mídia", () => {
    expect(posterUrl("capas/minha-novela.jpg")).toBe("/media/capas/minha-novela.jpg");
  });
});

describe("isGeneratedArt", () => {
  it("distingue arte gerada de arte real", () => {
    expect(isGeneratedArt("gen:capa/x")).toBe(true);
    expect(isGeneratedArt("capas/x.jpg")).toBe(false);
  });
});

describe("chaves com nome real de biblioteca", () => {
  it("codifica espaço e acento por segmento", () => {
    process.env.MEDIA_BASE_URL = "https://midia.exemplo.com";
    const fonte = resolveMedia({
      mediaKey: "A Filha Secreta do CEO/A Filha Secreta do CEO - E01.mp4",
    });
    expect(fonte.url).toBe(
      "https://midia.exemplo.com/A%20Filha%20Secreta%20do%20CEO/A%20Filha%20Secreta%20do%20CEO%20-%20E01.mp4",
    );
  });

  it("preserva as barras — codificar a chave inteira destruiria o caminho", () => {
    process.env.MEDIA_BASE_URL = "/media";
    const fonte = resolveMedia({ mediaKey: "Mãe por Um Milhão/E05.mp4" });
    expect(fonte.url.split("/").length).toBe(4);
    expect(fonte.url).toContain("M%C3%A3e");
  });

  it("não codifica duas vezes uma chave que já veio codificada", () => {
    process.env.MEDIA_BASE_URL = "/media";
    const fonte = resolveMedia({ mediaKey: "A%20Novela/E01.mp4" });
    expect(fonte.url).toBe("/media/A%20Novela/E01.mp4");
  });
});

describe("trailer", () => {
  // O trailer é um arquivo como qualquer outro na pasta da novela: passa pela
  // mesma resolução, e trocar disco por CDN não exige código novo.
  it("resolve a chave do trailer pela mesma camada dos episódios", () => {
    process.env.MEDIA_BASE_URL = "https://midia.exemplo.com";
    const fonte = resolveMedia({
      mediaKey: "Como domar um coroa/trailer.mp4",
      format: "mp4",
      thumbKey: "Como domar um coroa/poster.jpg",
    });
    expect(fonte.url).toBe(
      "https://midia.exemplo.com/Como%20domar%20um%20coroa/trailer.mp4",
    );
    expect(fonte.kind).toBe("mp4");
    expect(fonte.poster).toBe(
      "https://midia.exemplo.com/Como%20domar%20um%20coroa/poster.jpg",
    );
  });

  // Nenhum caminho de disco pode vazar para o cliente: a chave é relativa e a
  // base é configuração.
  it("não expõe caminho absoluto do computador", () => {
    process.env.MEDIA_BASE_URL = "/media";
    const fonte = resolveMedia({ mediaKey: "Como domar um coroa/trailer.mp4" });
    expect(fonte.url).toBe("/media/Como%20domar%20um%20coroa/trailer.mp4");
    // Nada de "D:\..." nem da raiz da biblioteca vazando na URL.
    expect(fonte.url.includes(":\\")).toBe(false);
    expect(fonte.url).not.toContain("Noveleiras de Plant");
  });
});
