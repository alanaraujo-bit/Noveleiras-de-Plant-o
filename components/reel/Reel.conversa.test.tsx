/**
 * A conversa dentro do reel inteiro.
 *
 * Aqui mora a disputa de gestos, e é por isso que este teste monta o reel de
 * verdade, com três lâminas, em vez de testar peças soltas:
 *
 * - com a conversa aberta o trilho trava, e nada na conversa troca episódio;
 * - arrastar o vídeo troca de episódio e a conversa vai junto, sem fechar;
 * - abrir e fechar depressa não deixa painel duplicado nem painel órfão;
 * - o episódio acabar enquanto ela escreve não leva o texto para outro;
 * - com movimento reduzido, nada espera animação.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { esquecerConversas } from "@/lib/player/conversas";
import type { LaminaReel } from "@/lib/repositories/reel";

const acoes = vi.hoisted(() => ({
  carregarComentarios: vi.fn(),
  carregarRespostas: vi.fn(),
  comentarEpisodio: vi.fn(),
  curtirComentario: vi.fn(),
  apagarComentario: vi.fn(),
  carregarMaisLaminas: vi.fn(),
  curtirEpisodio: vi.fn(),
  emendarSerie: vi.fn(),
  recarregarFila: vi.fn(),
  registrarDescarte: vi.fn(),
  registrarPermanencia: vi.fn(),
}));
vi.mock("@/lib/actions/reel", () => acoes);
vi.mock("@/components/sistema/TelemetryProvider", () => ({
  useTelemetry: () => ({ track: vi.fn(), sessionId: () => null }),
}));
vi.mock("@/components/sistema/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const { Reel } = await import("./Reel");

// ------------------------------------------------ observador controlado
//
// O jsdom não rola nem calcula interseção. O observador falso guarda o
// callback, e o teste diz qual lâmina "entrou em cena".
type Observador = { cb: IntersectionObserverCallback; alvos: Element[] };
let observador: Observador | null = null;

class ObservadorFalso {
  constructor(cb: IntersectionObserverCallback) {
    observador = { cb, alvos: [] };
  }
  observe(alvo: Element) {
    observador!.alvos.push(alvo);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function entrarEmCena(indice: number) {
  const alvo = observador!.alvos[indice]!;
  act(() => {
    observador!.cb(
      [{ isIntersecting: true, target: alvo } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

function lamina(n: number): LaminaReel {
  return {
    chave: `ep${n}`,
    origem: "serie",
    episodio: {
      id: `ep${n}`,
      numero: n,
      temporada: 1,
      titulo: `Episódio ${n}`,
      sinopse: "",
      gancho: "",
      duracaoSec: 90,
      capaUrl: `/capa${n}.jpg`,
      posicao: n,
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
    fonte: { kind: "mp4", url: `https://midia.exemplo/ep${n}.mp4`, poster: null },
    bloqueio: null,
    retomarEm: 0,
    social: { curtidas: 0, comentarios: 0, envios: 0, curtido: false },
  } as LaminaReel;
}

const viewer = { nome: "Ana", avatarSeed: "s", avatarUrl: null };

function montar() {
  const utils = render(
    <Reel
      laminasIniciais={[lamina(1), lamina(2), lamina(3)]}
      economiaDeDados={false}
      viewer={viewer}
    />,
  );
  const trilho = utils.container.querySelector(".trilho-reel") as HTMLElement;
  return { ...utils, trilho };
}

function abrir(indice = 0) {
  const botao = screen.getAllByRole("button", { name: "Comentários" })[indice]!;
  botao.focus();
  fireEvent.click(botao);
  return botao;
}

beforeEach(() => {
  esquecerConversas();
  observador = null;
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  // Movimento reduzido pelas preferências do app: as transições viram
  // instantâneas e o teste não depende do relógio de uma mola.
  document.documentElement.dataset.movimento = "reduzido";

  for (const f of Object.values(acoes)) f.mockReset();
  acoes.carregarComentarios.mockImplementation(async (id: string) => ({
    ok: true,
    comentarios: [],
    id,
  }));
  acoes.carregarMaisLaminas.mockResolvedValue({ ok: true, laminas: [] });
  acoes.emendarSerie.mockResolvedValue({ laminas: [] });
  acoes.registrarDescarte.mockResolvedValue(undefined);
  acoes.registrarPermanencia.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.movimento;
});

describe("abrir a conversa", () => {
  it("abre na hora, trava o trilho e não recria nenhum vídeo", () => {
    const { container, trilho } = montar();
    const videos = Array.from(container.querySelectorAll("video"));

    abrir();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Trilho travado: nada que aconteça na conversa pode rolar as lâminas.
    expect(trilho.style.overflowY).toBe("hidden");
    // Os mesmos elementos de vídeo, na mesma ordem.
    expect(Array.from(container.querySelectorAll("video"))).toEqual(videos);
  });

  it("rolar a lista da conversa nunca troca de episódio", async () => {
    const { trilho } = montar();
    abrir();
    await screen.findByText("Ninguém comentou ainda");

    const lista = screen.getByRole("dialog").querySelector("[aria-busy]")!;
    fireEvent.wheel(lista, { deltaY: 900 });
    fireEvent.scroll(lista);

    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
    expect(trilho.style.overflowY).toBe("hidden");
  });
});

describe("fechar", () => {
  it("pelo X: a conversa sai, o trilho volta a rolar e o foco volta ao botão", async () => {
    const { trilho } = montar();
    const botao = abrir();

    fireEvent.click(screen.getByRole("button", { name: "Fechar comentários" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trilho.style.overflowY).toBe("");
    expect(document.activeElement).toBe(botao);
  });

  it("abrir e fechar depressa várias vezes termina num estado coerente", async () => {
    montar();

    for (let i = 0; i < 6; i += 1) {
      abrir();
      fireEvent.click(screen.getByRole("button", { name: "Fechar comentários" }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    abrir();
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  });
});

describe("trocar de episódio com a conversa aberta", () => {
  it("arrastar sobre o vídeo salta para o próximo, e a conversa acompanha", async () => {
    montar();
    abrir();
    await screen.findByText("Ep 1");

    // A camada de toque da lâmina em cena.
    const camada = document.querySelector(
      "section[data-indice='0'] [role='button'][tabindex='0']",
    )!;
    fireEvent.pointerDown(camada, { pointerId: 1, clientX: 200, clientY: 500 });
    fireEvent.pointerMove(camada, { pointerId: 1, clientX: 204, clientY: 380 });
    fireEvent.pointerUp(camada, { pointerId: 1, clientX: 204, clientY: 380 });

    // Salto, e não rolagem animada: a faixa vazia entre duas cenas não
    // atravessa a área do vídeo.
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant" }),
    );

    // O trilho chegou à lâmina 2.
    entrarEmCena(1);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await screen.findByText("Ep 2")).toBeInTheDocument();
    await waitFor(() =>
      expect(acoes.carregarComentarios).toHaveBeenLastCalledWith("ep2"),
    );
  });

  it("o episódio acabar enquanto ela escreve espera o texto", async () => {
    const { container } = montar();
    abrir();
    await screen.findByText("Ninguém comentou ainda");

    const campo = screen.getByRole("textbox", { name: "Escrever um comentário" });
    fireEvent.input(campo, { target: { value: "Eu sabia!" } });

    fireEvent.ended(container.querySelector("section[data-indice='0'] video")!);
    // Ninguém trocou de cena: o texto é sobre este episódio.
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();

    // Apagou o texto: aí sim o reel segue.
    fireEvent.input(campo, { target: { value: "" } });
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant" }),
    );
  });

  it("sem conversa aberta, o fim do episódio desliza como sempre", () => {
    const { container } = montar();

    fireEvent.ended(container.querySelector("section[data-indice='0'] video")!);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });
});
