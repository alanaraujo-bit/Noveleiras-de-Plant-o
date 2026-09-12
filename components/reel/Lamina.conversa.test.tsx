/**
 * O player com a conversa aberta.
 *
 * A promessa central desta mudança: abrir os comentários **não mexe no vídeo**.
 * Mesmo elemento, mesma fonte, mesmo instante, sem recarregar — só o palco em
 * volta dele se move. Se qualquer uma dessas garantias quebrar, a novela pisca,
 * volta ao começo ou rebaixa, e é exatamente o que estes testes pegam.
 */
import { fireEvent, render } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutDaConversa } from "@/lib/player/enquadramento";
import type { LaminaReel } from "@/lib/repositories/reel";

vi.mock("@/components/sistema/TelemetryProvider", () => ({
  useTelemetry: () => ({ track: vi.fn(), sessionId: () => null }),
}));

const { Lamina } = await import("./Lamina");

const LAMINA = {
  chave: "ep1",
  origem: "serie",
  episodio: {
    id: "ep1",
    numero: 1,
    temporada: 1,
    titulo: "Episódio 1",
    sinopse: "",
    gancho: "",
    duracaoSec: 120,
    capaUrl: "/capa.jpg",
    posicao: 1,
    total: 10,
  },
  novela: {
    id: "nov",
    slug: "nov",
    titulo: "A Novela",
    accent: "#e03a69",
    posterUrl: "/p.jpg",
    tags: [],
    ageRating: "L",
  },
  fonte: { kind: "mp4", url: "https://midia.exemplo/ep1.mp4", poster: null },
  bloqueio: null,
  retomarEm: 0,
  social: { curtidas: 0, comentarios: 0, envios: 0, curtido: false },
} as LaminaReel;

const TELA = { largura: 440, altura: 956 };
const LAYOUT: LayoutDaConversa = {
  ...TELA,
  lado: "baixo",
  painel: 420,
  teclado: 0,
  topo: 10,
};

function props(sobre: Record<string, unknown> = {}) {
  return {
    lamina: LAMINA,
    indice: 0,
    ativa: true,
    montada: true,
    recuada: false,
    somLigado: true,
    economiaDeDados: false,
    contabilizavel: false,
    sessionId: () => null,
    aoBarrarSom: vi.fn(),
    aoAlternarSom: vi.fn(),
    aoTerminar: vi.fn(),
    aoCurtir: vi.fn(),
    aoAbrirComentarios: vi.fn(),
    aoEnviar: vi.fn(),
    abertura: motionValue(0),
    tela: TELA,
    conversa: null as LayoutDaConversa | null,
    reduzido: false,
    ...sobre,
  };
}

let load: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
});

afterEach(() => {
  load.mockRestore();
});

/** Um vídeo "tocando" no instante 42,5s, como o jsdom não sabe fazer sozinho. */
function tocandoEm(video: HTMLVideoElement, segundos: number, pausado = false) {
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    writable: true,
    value: segundos,
  });
  Object.defineProperty(video, "paused", { configurable: true, value: pausado });
}

describe("abrir a conversa durante a reprodução", () => {
  it("o vídeo é o mesmo elemento, na mesma fonte e no mesmo instante", () => {
    const abertura = motionValue(0);
    const { container, rerender } = render(<Lamina {...props({ abertura })} />);
    const video = container.querySelector("video")!;
    const fonte = video.getAttribute("src");
    tocandoEm(video, 42.5);
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();

    abertura.set(1);
    rerender(<Lamina {...props({ abertura, conversa: LAYOUT, recuada: true })} />);

    // O mesmo nó: nenhum remonte, nenhum flash, nada baixado de novo.
    expect(container.querySelector("video")).toBe(video);
    expect(video.getAttribute("src")).toBe(fonte);
    expect(video.currentTime).toBe(42.5);
    expect(load).not.toHaveBeenCalled();
    // Continuou tocando: abrir a conversa não pausa.
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("fechar devolve a tela cheia sem tocar no vídeo", () => {
    const abertura = motionValue(1);
    const { container, rerender } = render(
      <Lamina {...props({ abertura, conversa: LAYOUT, recuada: true })} />,
    );
    const video = container.querySelector("video")!;
    tocandoEm(video, 61);
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();

    abertura.set(0);
    rerender(<Lamina {...props({ abertura })} />);

    expect(container.querySelector("video")).toBe(video);
    expect(video.currentTime).toBe(61);
    expect(load).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("quem pausou continua pausada: abrir não retoma", () => {
    const abertura = motionValue(0);
    const { container, getByRole, rerender } = render(
      <Lamina {...props({ abertura })} />,
    );
    const video = container.querySelector("video")!;
    tocandoEm(video, 10, false);

    // Pausa pela pessoa (teclado, para não depender do relógio do toque).
    fireEvent.keyDown(getByRole("button", { name: /Pausar|Tocar/ }), {
      key: "Enter",
    });
    tocandoEm(video, 10, true);
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();

    abertura.set(1);
    rerender(<Lamina {...props({ abertura, conversa: LAYOUT, recuada: true })} />);

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

describe("enquadramento", () => {
  it("o palco se move a partir do topo ao centro, e o vídeo vai dentro dele", () => {
    const { container } = render(<Lamina {...props()} />);
    const video = container.querySelector("video")!;
    const palco = video.parentElement!;

    expect(palco.style.transformOrigin).toBe("50% 0%");
  });

  it("com os metadados, a caixa do vídeo ganha a proporção do conteúdo", () => {
    const { container } = render(<Lamina {...props()} />);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1080 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1920 });

    fireEvent.loadedMetadata(video);

    // A caixa de "cobrir" um 9:16 numa tela de 440×956: a altura da tela, e
    // a largura que o conteúdo pede — mais larga que a tela, de propósito.
    const mesmo = container.querySelector("video")!;
    expect(mesmo).toBe(video);
    expect(mesmo.style.height).toBe("956px");
    expect(parseFloat(mesmo.style.width)).toBeCloseTo(956 * (9 / 16), 1);
    // Sem isto a folha base limitaria o vídeo a 100% e ele esmagaria.
    expect(mesmo.className).toMatch(/max-w-none/);
  });
});

describe("metadados que chegaram antes da hidratação", () => {
  it("a proporção é lida mesmo sem o evento ter sido visto", () => {
    // O navegador carrega os metadados a partir do HTML do servidor, antes de
    // o React ligar os manipuladores. O vídeo já sabe as dimensões e o
    // `loadedmetadata` já passou — visto no Chrome de verdade.
    const largura = vi
      .spyOn(HTMLVideoElement.prototype, "videoWidth", "get")
      .mockReturnValue(1080);
    const altura = vi
      .spyOn(HTMLVideoElement.prototype, "videoHeight", "get")
      .mockReturnValue(1920);

    const { container } = render(<Lamina {...props()} />);
    const video = container.querySelector("video")!;

    // Nenhum evento disparado, e mesmo assim a caixa é a do conteúdo.
    expect(video.style.height).toBe("956px");
    expect(parseFloat(video.style.width)).toBeCloseTo(956 * (9 / 16), 1);

    largura.mockRestore();
    altura.mockRestore();
  });
});

describe("gestos com a conversa aberta", () => {
  it("fechada, o arrasto vertical é do trilho; aberta, é do reconhecedor", () => {
    const { container, rerender } = render(<Lamina {...props()} />);
    const camada = container.querySelector("[role='button'][tabindex='0']")!;
    expect(camada.className).toMatch(/touch-pan-y/);

    rerender(<Lamina {...props({ conversa: LAYOUT, recuada: true })} />);
    expect(camada.className).toMatch(/touch-none/);
  });

  it("aberta, a coluna de ações some e não recebe toque", () => {
    const { queryByRole, rerender } = render(<Lamina {...props()} />);
    expect(queryByRole("button", { name: "Comentários" })).not.toBeNull();

    rerender(<Lamina {...props({ conversa: LAYOUT, recuada: true })} />);
    // `invisible` tira o botão da árvore acessível e do toque.
    const botao = document.querySelector("[aria-label='Comentários']")!;
    expect(botao.closest(".invisible")).not.toBeNull();
  });
});
