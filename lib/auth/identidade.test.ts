import { describe, expect, it } from "vitest";

import {
  candidatosDeHandle,
  limparNome,
  normalizarHandle,
  validarHandle,
  validarNome,
} from "./identidade";

describe("@ da pessoa", () => {
  it("guarda minúsculo e sem o @ digitado", () => {
    expect(normalizarHandle("  @@Maria.Silva ")).toBe("maria.silva");
  });

  it("aceita letras, números, ponto e _", () => {
    expect(validarHandle("maria.silva_2")).toEqual({ ok: true, handle: "maria.silva_2" });
  });

  it.each([
    ["ma", "pelo menos"],
    ["maria silva", "Só letras"],
    ["mária", "Só letras"],
    [".maria", "começar nem terminar"],
    ["maria..silva", "dois símbolos"],
    ["12345", "pelo menos uma letra"],
    ["a".repeat(21), "No máximo"],
    ["Noveleiras", "reservado"],
    ["sup.orte", "reservado"],
  ])("recusa %s", (entrada, trecho) => {
    const r = validarHandle(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain(trecho);
  });
});

describe("nome vindo do Google", () => {
  it("arruma nome todo em maiúsculas, com conectivos minúsculos", () => {
    expect(limparNome("MARIA APARECIDA DA SILVA")).toBe("Maria Aparecida da Silva");
  });

  it("arruma nome todo em minúsculas e espaços sobrando", () => {
    expect(limparNome("  joão   dos  santos ")).toBe("João dos Santos");
  });

  it("não mexe em quem escreveu com cuidado", () => {
    expect(limparNome("Ana McDonald")).toBe("Ana McDonald");
  });

  it("recusa nome sem letras", () => {
    expect(validarNome("123").ok).toBe(false);
    expect(validarNome(" a ").ok).toBe(false);
  });
});

describe("sugestões de @", () => {
  it("sugere nome.sobrenome primeiro, sem número aleatório", () => {
    expect(candidatosDeHandle("Maria Aparecida da Silva")).toEqual([
      "maria.silva",
      "mariasilva",
      "maria",
      "maria_silva",
    ]);
  });

  it("tira acento e símbolo", () => {
    expect(candidatosDeHandle("Júlia ❤️ Conceição")[0]).toBe("julia.conceicao");
  });

  it("nome curto demais não vira sugestão inválida", () => {
    expect(candidatosDeHandle("Bo")).toEqual([]);
  });
});
