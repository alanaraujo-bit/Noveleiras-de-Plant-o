import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { NovelaDetail } from "@/lib/repositories/catalog";

/**
 * A ação de trailer, provada na tela.
 *
 * Antes isto só existia como verificação manual contra o app de pé, o que não
 * pega regressão. O que se prova aqui é o contrato de produto: a ação aparece
 * exatamente quando há trailer, abre um diálogo com o vídeo certo, fecha por
 * onde o espectador espera — e, o ponto mais importante, **não** encosta em
 * progresso de episódio.
 */

const alternarFavorito = vi.fn().mockResolvedValue({ ok: true, favorito: true });
const registrarAcessoNovela = vi.fn().mockResolvedValue(undefined);
const push = vi.fn();
const track = vi.fn();

vi.mock("@/lib/actions/catalogo", () => ({
  alternarFavorito: (...args: unknown[]) => alternarFavorito(...args),
  registrarAcessoNovela: (...args: unknown[]) => registrarAcessoNovela(...args),
}));

vi.mock("@/components/sistema/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock("@/components/sistema/TelemetryProvider", () => ({
  useTelemetry: () => ({ track }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const { PainelNovela } = await import("@/components/novela/PainelNovela");

const TRAILER_URL =
  "http://midia.local/Como%20domar%20um%20coroa/trailer.mp4";

function novelaFalsa(overrides: Partial<NovelaDetail> = {}): NovelaDetail {
  return {
    id: "nov_1",
    slug: "como-domar-um-coroa",
    title: "Como domar um coroa",
    tagline: "",
    accent: "#e11d48",
    posterUrl: "/media/poster.jpg",
    heroUrl: "/media/poster.jpg",
    accessTier: "FREE",
    status: "ONGOING",
    year: 2026,
    ageRating: "16",
    rating: 4.5,
    ratingCount: 10,
    episodeCount: 71,
    genres: [],
    editorialNote: null,
    isNew: false,
    synopsis: "Sinopse.",
    tags: [],
    cast: [],
    country: "BR",
    favoriteCount: 0,
    totalEpisodes: 71,
    isFavorite: false,
    seasons: [
      {
        id: "t1",
        number: 1,
        title: "Temporada 1",
        synopsis: null,
        episodes: [
          {
            id: "ep_1",
            number: 1,
            seasonNumber: 1,
            title: "Episódio 1",
            synopsis: "",
            durationSec: 120,
            thumbUrl: "/media/thumbs/E01.jpg",
            accessTier: "FREE",
            releasedAt: "2026-09-01T00:00:00.000Z",
            locked: false,
            lockReason: null,
            progress: null,
          },
        ],
      },
    ],
    trailer: {
      kind: "mp4",
      url: TRAILER_URL,
      poster: "/media/poster.jpg",
      tracks: [],
      durationSec: 0,
      provider: "LOCAL",
      expiresAt: null,
    },
    resume: {
      episodeId: "ep_1",
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Episódio 1",
      positionSec: 0,
      percent: 0,
      label: "Assistir do começo",
    },
    ...overrides,
  } as NovelaDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PainelNovela · trailer", () => {
  it("oferece a ação quando a novela tem trailer", () => {
    render(<PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />);
    expect(
      screen.getByRole("button", { name: "Assistir trailer" }),
    ).toBeInTheDocument();
  });

  // Botão desabilitado anunciaria um recurso que esta novela não tem. Some.
  it("não mostra a ação quando não há trailer", () => {
    render(
      <PainelNovela
        novela={novelaFalsa({ trailer: null })}
        esconderSpoiler={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Assistir trailer" }),
    ).toBeNull();
  });

  it("abre o diálogo com o vídeo do trailer na URL resolvida", async () => {
    const usuario = userEvent.setup();
    render(<PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    await usuario.click(screen.getByRole("button", { name: "Assistir trailer" }));

    const dialogo = await screen.findByRole("dialog");
    expect(dialogo).toHaveAttribute(
      "aria-label",
      "Trailer de Como domar um coroa",
    );
    expect(screen.getByTestId("video-trailer")).toHaveAttribute(
      "src",
      TRAILER_URL,
    );
  });

  /**
   * O ponto do produto: o trailer é amostra, não consumo. Progresso nasce na
   * rota `/assistir/[episodeId]`, que é quem grava `watchProgress`. Se o
   * trailer levasse até lá, quem só espiou apareceria como tendo começado a
   * novela, e o botão principal viraria "Continuar assistindo" sozinho.
   *
   * Por isso a prova é de navegação: o trailer abre por cima da página e não
   * encosta na rota que registra progresso.
   */
  it("não leva à rota que grava progresso de episódio", async () => {
    const usuario = userEvent.setup();
    const { container } = render(
      <PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />,
    );

    await usuario.click(screen.getByRole("button", { name: "Assistir trailer" }));
    const dialogo = await screen.findByRole("dialog");

    expect(push).not.toHaveBeenCalled();
    expect(dialogo.querySelector('a[href*="/assistir"]')).toBeNull();
    // O vídeo do trailer não referencia episódio nenhum.
    expect(screen.getByTestId("video-trailer")).not.toHaveAttribute(
      "data-episode-id",
    );

    await usuario.keyboard("{Escape}");
    expect(push).not.toHaveBeenCalled();
    // A página continua íntegra atrás do diálogo.
    expect(container).toBeTruthy();
  });

  it("fecha com Esc e devolve o foco a quem abriu", async () => {
    const usuario = userEvent.setup();
    render(<PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />);

    const abrir = screen.getByRole("button", { name: "Assistir trailer" });
    await usuario.click(abrir);
    await screen.findByRole("dialog");

    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(abrir).toHaveFocus();
  });

  it("fecha pelo botão de fechar", async () => {
    const usuario = userEvent.setup();
    render(<PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />);

    await usuario.click(screen.getByRole("button", { name: "Assistir trailer" }));
    await screen.findByRole("dialog");

    await usuario.click(
      screen.getAllByRole("button", { name: "Fechar trailer" })[0],
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // Trailer que não carrega precisa dizer isso; tela preta muda em silêncio
  // parece o app quebrado.
  it("explica quando o trailer não carrega, em vez de deixar tela preta", async () => {
    const usuario = userEvent.setup();
    render(<PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />);

    await usuario.click(screen.getByRole("button", { name: "Assistir trailer" }));
    const video = await screen.findByTestId("video-trailer");
    video.dispatchEvent(new Event("error"));

    expect(
      await screen.findByText("Não consegui carregar o trailer."),
    ).toBeInTheDocument();
  });

  // A página atrás não pode rolar sob o diálogo: no celular o dedo arrasta o
  // fundo em vez do vídeo.
  it("trava a rolagem da página enquanto o trailer está aberto", async () => {
    const usuario = userEvent.setup();
    render(<PainelNovela novela={novelaFalsa()} esconderSpoiler={false} />);

    await usuario.click(screen.getByRole("button", { name: "Assistir trailer" }));
    await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");

    await usuario.keyboard("{Escape}");
    await waitFor(() => expect(document.body.style.overflow).not.toBe("hidden"));
  });
});
