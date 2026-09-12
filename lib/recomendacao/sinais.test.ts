import { describe, expect, it } from "vitest";

import {
  FORCA_MINIMA,
  montarPerfil,
  pontuar,
  pontuarTendencia,
  type Corpus,
  type FatosDoEspectador,
} from "./sinais";

const AGORA = Date.parse("2026-09-12T20:00:00Z");
const horasAtras = (h: number) => new Date(AGORA - h * 3_600_000);
const diasAtras = (d: number) => horasAtras(d * 24);

/**
 * Catálogo de brinquedo: duas novelas de lobisomem, duas de CEO, uma de
 * herança. Termos e raridades escolhidos à mão para o teste ler como frase.
 */
const corpus: Corpus = {
  porNovela: new Map([
    ["lobo-a", ["lobisomem", "alcateia", "alfa"]],
    ["lobo-b", ["lobisomem", "alcateia", "lua"]],
    ["ceo-a", ["bilionario", "contrato", "casamento"]],
    ["ceo-b", ["bilionario", "contrato", "secretaria"]],
    ["heranca", ["herdeira", "testamento", "familia"]],
  ]),
  idf: new Map([
    ["lobisomem", 2],
    ["alcateia", 2],
    ["alfa", 1.5],
    ["lua", 1.5],
    ["bilionario", 2],
    ["contrato", 2],
    ["casamento", 1.5],
    ["secretaria", 1.5],
    ["herdeira", 2],
    ["testamento", 2],
    ["familia", 1],
  ]),
  generos: new Map(),
};

const vazio = (): FatosDoEspectador => ({
  progresso: [],
  favoritos: [],
  curtidas: [],
  eventos: [],
  tempo: [],
});

const ordem = (fatos: FatosDoEspectador, candidatas: string[]) => {
  const perfil = montarPerfil(fatos, corpus, AGORA);
  return candidatas
    .map((id) => ({ id, v: pontuar(id, perfil, corpus, { popularidade: 0 }).valor }))
    .sort((a, b) => b.v - a.v)
    .map((c) => c.id);
};

describe("perfil de gosto", () => {
  it("quem assistiu mais minutos de um tipo recebe mais desse tipo", () => {
    const fatos = vazio();
    fatos.tempo = [
      { novelaId: "lobo-a", quando: diasAtras(2), ms: 40 * 60_000 },
      { novelaId: "ceo-a", quando: diasAtras(2), ms: 2 * 60_000 },
    ];
    expect(ordem(fatos, ["ceo-b", "lobo-b"])).toEqual(["lobo-b", "ceo-b"]);
  });

  it("minutos pesam por logaritmo: uma maratona não apaga o resto", () => {
    const fatos = vazio();
    fatos.tempo = [{ novelaId: "lobo-a", quando: diasAtras(1), ms: 180 * 60_000 }];
    fatos.progresso = [
      { novelaId: "ceo-a", percent: 100, completed: true, quando: diasAtras(1) },
    ];
    fatos.favoritos = [{ novelaId: "ceo-a", quando: diasAtras(1) }];
    fatos.curtidas = [{ novelaId: "ceo-a", quando: diasAtras(1) }];
    // 3 h de lobisomem contra um episódio concluído + favorito + curtida de CEO:
    // o CEO não pode sumir do perfil só porque houve uma maratona.
    const perfil = montarPerfil(fatos, corpus, AGORA);
    const lobo = pontuar("lobo-b", perfil, corpus, { popularidade: 0 }).valor;
    const ceo = pontuar("ceo-b", perfil, corpus, { popularidade: 0 }).valor;
    expect(ceo).toBeGreaterThan(lobo * 0.5);
  });

  it("o que ela fez agora há pouco pesa mais que o mesmo fato de dias atrás", () => {
    const fatos = vazio();
    fatos.tempo = [
      { novelaId: "ceo-a", quando: diasAtras(4), ms: 20 * 60_000 },
      { novelaId: "lobo-a", quando: horasAtras(1), ms: 20 * 60_000 },
    ];
    expect(ordem(fatos, ["ceo-b", "lobo-b"])).toEqual(["lobo-b", "ceo-b"]);
  });

  it("gosto de semanas atrás perde força, mas não some", () => {
    const fatos = vazio();
    fatos.tempo = [{ novelaId: "heranca", quando: diasAtras(28), ms: 30 * 60_000 }];
    const perfil = montarPerfil(fatos, corpus, AGORA);
    expect(perfil.forca).toBeGreaterThan(0);
    expect(perfil.forca).toBeLessThan(
      montarPerfil(
        { ...vazio(), tempo: [{ novelaId: "heranca", quando: diasAtras(1), ms: 30 * 60_000 }] },
        corpus,
        AGORA,
      ).forca,
    );
  });

  it("sem sinal suficiente, o perfil não decide", () => {
    const fatos = vazio();
    fatos.eventos = [
      { tipo: "NOVELA_VIEW", novelaId: "lobo-a", quando: diasAtras(1), valorMs: null },
    ];
    expect(montarPerfil(fatos, corpus, AGORA).forca).toBeLessThan(FORCA_MINIMA);
  });
});

describe("descartes e recusa", () => {
  const descarte = (novelaId: string, quando: Date, valorMs: number | null) => ({
    tipo: "REEL_SLIDE_SKIP" as const,
    novelaId,
    quando,
    valorMs,
  });

  it("dois descartes decididos e recentes tiram a obra da descoberta", () => {
    const fatos = vazio();
    fatos.eventos = [descarte("ceo-a", diasAtras(1), 1500), descarte("ceo-a", diasAtras(2), 1400)];
    expect(montarPerfil(fatos, corpus, AGORA).recusadas.has("ceo-a")).toBe(true);
  });

  it("a recusa expira: descartes de mais de três semanas deixam a obra voltar", () => {
    const fatos = vazio();
    fatos.eventos = [descarte("ceo-a", diasAtras(30), 1500), descarte("ceo-a", diasAtras(31), 1500)];
    expect(montarPerfil(fatos, corpus, AGORA).recusadas.has("ceo-a")).toBe(false);
  });

  it("passar no reflexo, sem ver a cena, não conta como recusa", () => {
    const fatos = vazio();
    fatos.eventos = [descarte("ceo-a", diasAtras(1), 250), descarte("ceo-a", diasAtras(1), 300)];
    expect(montarPerfil(fatos, corpus, AGORA).recusadas.has("ceo-a")).toBe(false);
  });

  it("descartar uma obra que ela assiste não é rejeição", () => {
    const fatos = vazio();
    fatos.tempo = [{ novelaId: "lobo-a", quando: diasAtras(1), ms: 15 * 60_000 }];
    fatos.eventos = [descarte("lobo-a", diasAtras(1), 1500), descarte("lobo-a", diasAtras(1), 1500)];
    expect(montarPerfil(fatos, corpus, AGORA).recusadas.has("lobo-a")).toBe(false);
  });

  it("um descarte não derruba o tipo inteiro que ela gosta", () => {
    const fatos = vazio();
    fatos.tempo = [{ novelaId: "lobo-a", quando: diasAtras(1), ms: 30 * 60_000 }];
    fatos.eventos = [descarte("lobo-b", diasAtras(1), 1500)];
    const perfil = montarPerfil(fatos, corpus, AGORA);
    expect(perfil.termos.get("lobisomem") ?? 0).toBeGreaterThan(0);
  });
});

describe("em alta", () => {
  const base = { minutosRecentes: 0, espectadores: 0, ficaram: 0, passaram: 0, visualizacoesDeSempre: 0 };

  it("o que estão assistindo agora vence o que foi muito visto no passado", () => {
    const agora = pontuarTendencia({ ...base, minutosRecentes: 30, espectadores: 3 });
    const antiga = pontuarTendencia({ ...base, visualizacoesDeSempre: 500 });
    expect(agora.valor).toBeGreaterThan(antiga.valor);
    expect(agora.assistidaAgora).toBe(true);
    expect(antiga.assistidaAgora).toBe(false);
  });

  it("muita gente pesa mais que uma pessoa maratonando", () => {
    const muitos = pontuarTendencia({ ...base, minutosRecentes: 40, espectadores: 6 });
    const um = pontuarTendencia({ ...base, minutosRecentes: 60, espectadores: 1 });
    expect(muitos.valor).toBeGreaterThan(um.valor);
  });

  it("abertura que segura quem começa sobe acima da que todo mundo pula", () => {
    const segura = pontuarTendencia({ ...base, minutosRecentes: 20, espectadores: 2, ficaram: 12, passaram: 2 });
    const pulam = pontuarTendencia({ ...base, minutosRecentes: 20, espectadores: 2, ficaram: 2, passaram: 12 });
    expect(segura.valor).toBeGreaterThan(pulam.valor);
  });

  it("com pouquíssimos dados, um descarte isolado quase não mexe", () => {
    const semDado = pontuarTendencia({ ...base, minutosRecentes: 20, espectadores: 2 });
    const umDescarte = pontuarTendencia({ ...base, minutosRecentes: 20, espectadores: 2, passaram: 1 });
    expect(umDescarte.valor / semDado.valor).toBeGreaterThan(0.85);
  });
});
