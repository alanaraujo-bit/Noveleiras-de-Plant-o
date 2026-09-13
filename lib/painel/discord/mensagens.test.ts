import { describe, expect, it } from "vitest";

import { indicador } from "@/lib/painel/numeros";

import {
  EMBEDS_POR_MENSAGEM,
  embedDoFato,
  escaparMarkdown,
  fmtComparacao,
  mensagemDoRelatorio,
  mensagensDosFatos,
  type Fato,
} from "./mensagens";

function cadastro(i: number): Fato {
  return {
    tipo: "cadastro",
    chave: `cadastro:u${i}`,
    userId: `u${i}`,
    nome: `Pessoa ${i}`,
    email: `p${i}@exemplo.com`,
    metodo: "email",
    aparelho: "Android · Chrome",
    origem: null,
    em: new Date("2026-09-14T13:00:00.000Z"),
    totalDeContas: 100 + i,
  };
}

describe("mensagens de fatos", () => {
  it("uma rajada vira mensagens de no máximo dez embeds", () => {
    const fatos = Array.from({ length: 23 }, (_, i) => cadastro(i));
    const mensagens = mensagensDosFatos(fatos, null);
    expect(mensagens).toHaveLength(3);
    expect(mensagens.map((m) => m.embeds.length)).toEqual([
      EMBEDS_POR_MENSAGEM,
      EMBEDS_POR_MENSAGEM,
      3,
    ]);
  });

  it("nunca permite menção — nome de usuário não pinga o canal", () => {
    const [mensagem] = mensagensDosFatos([cadastro(1)], null);
    expect(mensagem.allowed_mentions).toEqual({ parse: [] });
  });

  it("aponta para a ficha da pessoa quando há endereço do app", () => {
    const embed = embedDoFato(cadastro(7), "https://app.exemplo.com/");
    expect(embed.url).toBe("https://app.exemplo.com/painel/usuarios/u7");
  });

  it("escapa markdown de texto livre", () => {
    expect(escaparMarkdown("**Maria**_")).toBe("\\*\\*Maria\\*\\*\\_");
  });
});

describe("relatório", () => {
  it("não inventa percentual quando a janela anterior era zero", () => {
    expect(fmtComparacao(indicador(5, 0))).toBe(" · antes: 0");
    expect(fmtComparacao(indicador(0, 0))).toBe("");
    expect(fmtComparacao(indicador(12, 10))).toBe(" · ▲ 20%");
    expect(fmtComparacao(indicador(8, 10))).toBe(" · ▼ 20%");
  });

  it("traz os números que a operação pediu", () => {
    const zero = indicador(0, 0);
    const mensagem = mensagemDoRelatorio(
      {
        rotuloDoIntervalo: "Uma vez por dia",
        inicio: new Date("2026-09-13T11:00:00.000Z"),
        fim: new Date("2026-09-14T11:00:00.000Z"),
        cadastros: indicador(3, 1),
        contasTotais: 250,
        novosAssinantes: indicador(2, 0),
        cancelamentos: zero,
        assinantesAtivos: 40,
        mrrCents: 39_960,
        receitaCents: indicador(1_998, 999),
        tempoAssistidoMs: indicador(7_200_000, 3_600_000),
        reproducoes: indicador(30, 20),
        espectadores: indicador(12, 10),
        sessoes: indicador(50, 40),
        errosDoSistema: 0,
        alertasAbertos: 0,
        maisAssistidas: [{ titulo: "A Favorita", reproducoes: 9, tempoAssistidoMs: 3_600_000 }],
        quemChegou: ["Ana", "Bia", "Cris"],
      },
      null,
    );
    const nomes = mensagem.embeds[0].fields?.map((f) => f.name);
    expect(nomes).toEqual(
      expect.arrayContaining([
        "Cadastros",
        "Novos assinantes",
        "Receita",
        "Horas assistidas",
        "Assinantes ativos",
        "Mais assistidas",
        "Quem chegou",
      ]),
    );
    const horas = mensagem.embeds[0].fields?.find((f) => f.name === "Horas assistidas");
    expect(horas?.value).toBe("**2 h** · ▲ 100%");
  });
});
