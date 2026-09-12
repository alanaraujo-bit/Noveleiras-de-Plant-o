import { describe, expect, it } from "vitest";

import {
  GENEROS,
  classificarTemas,
  generosDeTemas,
  type TemaDaOrigem,
} from "./temas";

const tema = (valor: string, grupo: string): TemaDaOrigem => ({
  chave: `k-${valor}`,
  valor,
  grupo,
});

const ELENCO_M = "1001";
const ELENCO_F = "1005";
const PAPEL = "1020";
const ENREDO = "1022";
const LUGAR = "1023";
const TOM = "1012";
const PAIS = "1013";
const CLASSIFICACAO = "1015";
const PUBLICO = "1000";
const EPOCA = "1014";
const GENERO_ORIGEM = "1010";

describe("classificação dos temas da origem", () => {
  it("separa elenco de enredo pelo grupo", () => {
    const r = classificarTemas([
      tema("Marc Herrmann", ELENCO_M),
      tema("Meg Bush", ELENCO_F),
      tema("Lobisomem", PAPEL),
    ]);
    expect(r.elenco).toEqual(["Marc Herrmann", "Meg Bush"]);
    expect(r.tags).toEqual(["Lobisomem"]);
  });

  it("país e classificação indicativa saem das tags e viram campo", () => {
    const r = classificarTemas([
      tema("Estados Unidos", PAIS),
      tema("Somente para adultos", CLASSIFICACAO),
      tema("Vingança", ENREDO),
    ]);
    expect(r.pais).toBe("Estados Unidos");
    expect(r.classificacao).toBe("18");
    expect(r.tags).toEqual(["Vingança"]);
  });

  it("novela sem marca de conteúdo adulto não ganha classificação nova", () => {
    const r = classificarTemas([tema("Todas as Idades", CLASSIFICACAO)]);
    expect(r.classificacao).toBeNull();
  });

  it("público e época não viram tag: dizem para quem é, não do que trata", () => {
    const r = classificarTemas([
      tema("Feminina", PUBLICO),
      tema("Contemporâneo", EPOCA),
      tema("Romance", GENERO_ORIGEM),
      tema("Gravidez", ENREDO),
    ]);
    expect(r.tags).toEqual(["Gravidez"]);
  });

  it("traduz o que a origem mandou em inglês e não duplica com o português", () => {
    const r = classificarTemas([
      tema("Enemies to Lovers", ENREDO),
      tema("Inimigos para Amantes", ENREDO),
      tema("Mansion", LUGAR),
    ]);
    expect(r.tags).toEqual(["Inimigos para Amantes", "Mansão"]);
  });

  it("tags que estão em metade do catálogo não descrevem nada e caem fora", () => {
    const r = classificarTemas([
      tema("Moderno", "1011"),
      tema("Clássico", TOM),
      tema("Lobisomem", PAPEL),
    ]);
    expect(r.tags).toEqual(["Lobisomem"]);
  });

  it("manifesto antigo, sem grupo, ainda vira tag — e não inventa elenco", () => {
    const r = classificarTemas([
      { chave: "k1", valor: "Vingança", grupo: "" },
      { chave: "k2", valor: "Marc Herrmann", grupo: "" },
    ]);
    expect(r.tags).toEqual(["Vingança", "Marc Herrmann"]);
    expect(r.elenco).toEqual([]);
  });
});

describe("gêneros a partir dos temas", () => {
  it("um tema forte sozinho já decide o gênero", () => {
    expect(generosDeTemas(["Lobisomem"])).toEqual(["alcateia-e-sobrenatural"]);
  });

  it("um tema periférico sozinho não decide nada", () => {
    expect(generosDeTemas(["Mansão"])).toEqual([]);
  });

  it("dois temas periféricos somados entram no gênero", () => {
    expect(generosDeTemas(["Mansão", "Bilionário"])).toEqual(["heranca-e-poder"]);
  });

  it("ordena do gênero mais sustentado para o menos", () => {
    const generos = generosDeTemas([
      "Lobisomem",
      "Alfa",
      "Luna",
      "Bilionário",
      "Mansão",
    ]);
    expect(generos[0]).toBe("alcateia-e-sobrenatural");
    expect(generos).toContain("heranca-e-poder");
  });

  it("no máximo três gêneros por novela", () => {
    const generos = generosDeTemas([
      "Lobisomem",
      "Alfa",
      "Vingança",
      "Dando o troco no ex",
      "Bilionário",
      "CEO",
      "Divórcio",
      "Segunda Chance",
      "Amor Proibido",
      "Tabu",
    ]);
    expect(generos).toHaveLength(3);
  });

  it("um tema que está em quase todo o catálogo não pontua", () => {
    expect(generosDeTemas(["Revelação de Identidade", "Revelação Secreta"])).toEqual([]);
  });

  it("os gêneros pontuados existem todos na lista do produto", () => {
    const conhecidos = new Set(GENEROS.map((g) => g.slug));
    const todos = generosDeTemas([
      "Lobisomem", "Vingança", "CEO", "Casamento Relâmpago", "Poder Feminino",
      "Inimigos para Amantes", "Leve e divertido", "Filho Secreto", "Reunião",
      "Assassinato", "Campus", "Amor Proibido", "Divórcio", "Romance no Escritório",
    ]);
    for (const slug of todos) expect(conhecidos.has(slug)).toBe(true);
  });

  it("a lista de gêneros não tem slug repetido", () => {
    const slugs = GENEROS.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
