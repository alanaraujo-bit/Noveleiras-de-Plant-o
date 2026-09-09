import { describe, expect, it } from "vitest";

import {
  assinarUrl,
  calcularAssinatura,
  normalizar,
  validarAssinatura,
} from "./assinatura";

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente";
const CHAVE = "A Sem-Pelo/A Sem-Pelo - E06.mp4";

function agora(): number {
  return Math.floor(Date.now() / 1000);
}

function parametrosDe(url: string) {
  const busca = new URL(url, "http://localhost:8099").searchParams;
  return {
    exp: busca.get("exp"),
    u: busca.get("u"),
    sig: busca.get("sig"),
  };
}

describe("assinarUrl", () => {
  it("sem segredo, devolve a URL intacta", () => {
    // Modo de desenvolvimento: os dois lados destravam juntos. Assinar aqui
    // sem o servidor conferir produziria só ruído na URL.
    const r = assinarUrl("http://localhost:8099/x.mp4", "x.mp4", "u1", null);
    expect(r.url).toBe("http://localhost:8099/x.mp4");
    expect(r.expiraEm).toBeNull();
  });

  it("acrescenta prazo, usuário e assinatura", () => {
    const r = assinarUrl(
      "http://localhost:8099/video.mp4",
      "video.mp4",
      "usuario-1",
      SEGREDO,
    );
    const p = parametrosDe(r.url);
    expect(p.u).toBe("usuario-1");
    expect(p.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(p.exp)).toBeGreaterThan(agora());
    expect(r.expiraEm).toBeInstanceOf(Date);
  });

  it("preserva query string que já existia", () => {
    const r = assinarUrl(
      "https://cdn.exemplo.com/v.mp4?v=2",
      "v.mp4",
      "u1",
      SEGREDO,
    );
    expect(r.url).toContain("v=2");
    expect(r.url).toContain("&sig=");
  });
});

describe("validarAssinatura", () => {
  it("aceita a assinatura que acabou de gerar", () => {
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", SEGREDO);
    expect(validarAssinatura(CHAVE, parametrosDe(r.url), SEGREDO)).toEqual({
      valida: true,
    });
  });

  it("recusa quando não há assinatura nenhuma", () => {
    expect(validarAssinatura(CHAVE, {}, SEGREDO)).toEqual({
      valida: false,
      motivo: "sem-assinatura",
    });
  });

  it("recusa link vencido", () => {
    const expira = agora() - 10;
    const sig = calcularAssinatura(
      { caminho: CHAVE, expira, usuario: "u1" },
      SEGREDO,
    );
    expect(
      validarAssinatura(CHAVE, { exp: String(expira), u: "u1", sig }, SEGREDO),
    ).toEqual({ valida: false, motivo: "expirada" });
  });

  it("recusa assinatura de outro segredo", () => {
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", "outro-segredo-aqui");
    expect(
      validarAssinatura(CHAVE, parametrosDe(r.url), SEGREDO).valida,
    ).toBe(false);
  });

  it("não deixa esticar o prazo alterando exp", () => {
    // O ataque óbvio de quem tem um link: trocar `exp` por uma data distante.
    // Como `exp` entra no texto assinado, isso invalida a assinatura.
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", SEGREDO);
    const p = parametrosDe(r.url);
    const esticado = { ...p, exp: String(agora() + 10 * 365 * 86_400) };
    expect(validarAssinatura(CHAVE, esticado, SEGREDO)).toEqual({
      valida: false,
      motivo: "invalida",
    });
  });

  it("não serve para outro arquivo", () => {
    // Link do episódio 6 não pode virar link do episódio 7.
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", SEGREDO);
    const outro = "A Sem-Pelo/A Sem-Pelo - E07.mp4";
    expect(validarAssinatura(outro, parametrosDe(r.url), SEGREDO).valida).toBe(
      false,
    );
  });

  it("não serve para outro usuário", () => {
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", SEGREDO);
    const p = parametrosDe(r.url);
    expect(
      validarAssinatura(CHAVE, { ...p, u: "u2" }, SEGREDO).valida,
    ).toBe(false);
  });

  it("confere igual com o caminho percent-encoded da URL", () => {
    // O aplicativo assina a chave do banco ("A Sem-Pelo/...") e o servidor
    // recebe o pathname escapado. Sem normalizar, toda mídia com espaço ou
    // acento — a maioria — falharia.
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", SEGREDO);
    const daUrl = encodeURI(CHAVE);
    expect(daUrl).not.toBe(CHAVE);
    expect(validarAssinatura(daUrl, parametrosDe(r.url), SEGREDO)).toEqual({
      valida: true,
    });
  });

  it("recusa exp não numérico em vez de explodir", () => {
    const r = assinarUrl("http://x/a.mp4", CHAVE, "u1", SEGREDO);
    const p = parametrosDe(r.url);
    expect(
      validarAssinatura(CHAVE, { ...p, exp: "amanhã" }, SEGREDO),
    ).toEqual({ valida: false, motivo: "invalida" });
  });
});

describe("normalizar", () => {
  it("tira barra inicial e decodifica", () => {
    expect(normalizar("/A%20Sem-Pelo/x.mp4")).toBe("A Sem-Pelo/x.mp4");
  });

  it("aguenta percentagem malformada", () => {
    expect(() => normalizar("a%ZZb.mp4")).not.toThrow();
  });
});
