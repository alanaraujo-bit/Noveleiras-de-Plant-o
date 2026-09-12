/**
 * A conversa do episódio, estado por estado.
 *
 * O que estes testes seguram:
 *
 * - o painel abre **na hora**, com esqueleto, sem esperar o servidor;
 * - erro de carregamento é erro, com saída — nunca "Ninguém comentou ainda";
 * - reabrir o mesmo episódio não busca de novo;
 * - enviar aparece no quadro do toque, e falhar devolve o texto ao campo;
 * - o arrasto no punho acompanha o dedo e decide pelo limiar, e o arrasto na
 *   lista é da lista;
 * - trocar de episódio com o painel aberto atualiza a conversa sem remontar.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { esquecerConversas } from "@/lib/player/conversas";
import type { LayoutDaConversa } from "@/lib/player/enquadramento";
import type { ComentarioDeEpisodio } from "@/lib/repositories/episodio-social";
import type { LaminaReel } from "@/lib/repositories/reel";

const acoes = vi.hoisted(() => ({
  carregarComentarios: vi.fn(),
  carregarRespostas: vi.fn(),
  comentarEpisodio: vi.fn(),
  curtirComentario: vi.fn(),
  apagarComentario: vi.fn(),
}));
vi.mock("@/lib/actions/reel", () => acoes);

const toast = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("@/components/sistema/ToastProvider", () => ({ useToast: () => toast }));

const { Comentarios } = await import("./Comentarios");

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
      capaUrl: "/capa.jpg",
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
    fonte: null,
    bloqueio: null,
    retomarEm: 0,
    social: { curtidas: 0, comentarios: 0, envios: 0, curtido: false },
  } as LaminaReel;
}

function comentario(id: string, body = `Comentário ${id}`): ComentarioDeEpisodio {
  return {
    id,
    body,
    spoiler: false,
    createdAt: new Date().toISOString(),
    isOwn: false,
    author: { id: "a", name: "Rosa", handle: "rosa", avatarSeed: "s", avatarUrl: null },
    curtidas: 0,
    curtido: false,
    respostas: 0,
    respondendoA: null,
  };
}

const LAYOUT: LayoutDaConversa = {
  largura: 440,
  altura: 956,
  lado: "baixo",
  painel: 420,
  teclado: 0,
  topo: 10,
};

const viewer = { nome: "Ana", avatarSeed: "s", avatarUrl: null };

function montar(sobre: Partial<Parameters<typeof Comentarios>[0]> = {}) {
  const props = {
    lamina: lamina(1),
    abertura: motionValue(1),
    layout: LAYOUT,
    transicao: { duration: 0 },
    viewer,
    aoFechar: vi.fn(),
    aoRascunho: vi.fn(),
    aoMudarTotal: vi.fn(),
    ...sobre,
  };
  const utils = render(<Comentarios {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  esquecerConversas();
  for (const f of Object.values(acoes)) f.mockReset();
  toast.show.mockReset();
  // O punho captura o ponteiro, e publicar rola a lista até o topo; o jsdom
  // não implementa nenhum dos dois.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("abrir", () => {
  it("abre na hora com esqueleto, sem esperar o servidor", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    montar();

    const painel = screen.getByRole("dialog");
    expect(painel).toBeInTheDocument();
    expect(painel.querySelector("[aria-busy='true']")).not.toBeNull();
    // Carregando não é vazio: dizer "ninguém comentou" antes de saber é mentir.
    expect(screen.queryByText("Ninguém comentou ainda")).toBeNull();
  });

  it("sem comentários, convida a ser a primeira", async () => {
    acoes.carregarComentarios.mockResolvedValue({ ok: true, comentarios: [] });
    montar();

    expect(await screen.findByText("Ninguém comentou ainda")).toBeInTheDocument();
    expect(
      screen.getByText("Seja a primeira pessoa a falar deste episódio."),
    ).toBeInTheDocument();
  });

  it("o foco vai para o painel, e não para o campo — o teclado não sobe sozinho", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    montar();

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });
});

describe("erro de carregamento", () => {
  it("é dito como erro, com um jeito de tentar de novo", async () => {
    acoes.carregarComentarios
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce({ ok: true, comentarios: [comentario("c1", "Que cena!")] });
    montar();

    expect(await screen.findByText("Os comentários não carregaram")).toBeInTheDocument();
    expect(screen.queryByText("Ninguém comentou ainda")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("Que cena!")).toBeInTheDocument();
    expect(acoes.carregarComentarios).toHaveBeenCalledTimes(2);
  });
});

describe("muitos comentários", () => {
  it("todos na lista, que rola sozinha, dentro do painel", async () => {
    const muitos = Array.from({ length: 80 }, (_, i) => comentario(`c${i}`));
    acoes.carregarComentarios.mockResolvedValue({ ok: true, comentarios: muitos });
    const { container } = montar();

    expect(await screen.findByText("Comentário c79")).toBeInTheDocument();
    const lista = container.querySelector("[aria-busy]")!;
    // Rolagem própria e contida: o fim da lista não vaza para o reel.
    expect(lista.className).toMatch(/overflow-y-auto/);
    expect(lista.className).toMatch(/overscroll-contain/);
  });
});

describe("memória da sessão", () => {
  it("reabrir o mesmo episódio não busca de novo e não mostra esqueleto", async () => {
    acoes.carregarComentarios.mockResolvedValue({
      ok: true,
      comentarios: [comentario("c1", "Já li")],
    });
    const primeiro = montar();
    await screen.findByText("Já li");
    primeiro.unmount();

    montar();
    // Na primeira pintura: sem esqueleto, sem ida ao servidor.
    expect(screen.getByText("Já li")).toBeInTheDocument();
    expect(acoes.carregarComentarios).toHaveBeenCalledTimes(1);
  });
});

describe("escrever", () => {
  it("o comentário aparece na hora e se confirma quando o servidor responde", async () => {
    acoes.carregarComentarios.mockResolvedValue({ ok: true, comentarios: [] });
    let responder: (v: unknown) => void = () => {};
    acoes.comentarEpisodio.mockReturnValue(new Promise((r) => (responder = r)));
    const { props } = montar();
    await screen.findByText("Ninguém comentou ainda");

    const campo = screen.getByRole("textbox", { name: "Escrever um comentário" });
    fireEvent.input(campo, { target: { value: "Que reviravolta!" } });
    expect(props.aoRascunho).toHaveBeenLastCalledWith(true);

    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });

    // Enquanto o servidor pensa: já está na lista, marcado como enviando.
    expect(screen.getByText("Que reviravolta!")).toBeInTheDocument();
    expect(screen.getByText("enviando…")).toBeInTheDocument();
    expect(props.aoRascunho).toHaveBeenLastCalledWith(false);

    await act(async () => {
      responder({
        ok: true,
        comentario: { ...comentario("novo", "Que reviravolta!"), isOwn: true },
        total: 1,
      });
    });

    await waitFor(() => expect(screen.queryByText("enviando…")).toBeNull());
    expect(screen.getByText("Que reviravolta!")).toBeInTheDocument();
    expect(props.aoMudarTotal).toHaveBeenCalledWith("ep1", 1);
  });

  it("se o envio falha, o texto volta para o campo", async () => {
    acoes.carregarComentarios.mockResolvedValue({ ok: true, comentarios: [] });
    acoes.comentarEpisodio.mockResolvedValue({ ok: false, motivo: "erro" });
    const { props } = montar();
    await screen.findByText("Ninguém comentou ainda");

    const campo = screen.getByRole("textbox", {
      name: "Escrever um comentário",
    }) as HTMLTextAreaElement;
    fireEvent.input(campo, { target: { value: "Não quero perder isso" } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });

    await waitFor(() => expect(campo.value).toBe("Não quero perder isso"));
    expect(toast.show).toHaveBeenCalled();
    expect(props.aoRascunho).toHaveBeenLastCalledWith(true);
  });
});

describe("teclado", () => {
  it("com o teclado aberto, o painel fica acima dele", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    montar({ layout: { ...LAYOUT, teclado: 300, painel: 360 } });

    const painel = screen.getByRole("dialog");
    expect(painel.style.bottom).toBe("300px");
    expect(painel.style.height).toBe("360px");
  });
});

describe("arrastar para fechar", () => {
  function punho() {
    return document.querySelector("[data-punho-da-conversa]") as HTMLElement;
  }

  it("o painel acompanha o dedo e volta ao lugar se o arrasto for curto", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const abertura = motionValue(1);
    const { props } = montar({ abertura });

    fireEvent.pointerDown(punho(), { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(punho(), { pointerId: 1, clientY: 150 });
    // 50px de 420: o painel (e o vídeo, que lê o mesmo valor) desceram junto.
    expect(abertura.get()).toBeCloseTo(1 - 50 / 420, 3);

    fireEvent.pointerUp(punho(), { pointerId: 1, clientY: 150 });
    expect(props.aoFechar).not.toHaveBeenCalled();
  });

  it("um puxão rápido e decidido fecha mesmo antes do limiar", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const { props } = montar();

    // 90px em 60ms: um arremesso de verdade, bem abaixo dos 126px do limiar.
    fireEvent.pointerDown(punho(), { pointerId: 1, clientY: 100 });
    vi.advanceTimersByTime(30);
    fireEvent.pointerMove(punho(), { pointerId: 1, clientY: 145 });
    vi.advanceTimersByTime(30);
    fireEvent.pointerMove(punho(), { pointerId: 1, clientY: 190 });
    fireEvent.pointerUp(punho(), { pointerId: 1, clientY: 190 });

    expect(props.aoFechar).toHaveBeenCalledTimes(1);
  });

  it("um arrasto curto chegando num evento só não conta como arremesso", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const { props } = montar();

    // O celular agrupa eventos por quadro: 50px num único evento parece rápido
    // e não é intenção de fechar.
    fireEvent.pointerDown(punho(), { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(punho(), { pointerId: 1, clientY: 150 });
    fireEvent.pointerUp(punho(), { pointerId: 1, clientY: 150 });

    expect(props.aoFechar).not.toHaveBeenCalled();
  });

  it("passando do limiar, fecha", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const { props } = montar();

    fireEvent.pointerDown(punho(), { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(punho(), { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(punho(), { pointerId: 1, clientY: 300 });

    expect(props.aoFechar).toHaveBeenCalledTimes(1);
  });

  it("arrastar na lista rola a lista — não fecha nem move o painel", async () => {
    acoes.carregarComentarios.mockResolvedValue({
      ok: true,
      comentarios: [comentario("c1")],
    });
    const abertura = motionValue(1);
    const { props, container } = montar({ abertura });
    await screen.findByText("Comentário c1");

    const lista = container.querySelector("[aria-busy]") as HTMLElement;
    fireEvent.pointerDown(lista, { pointerId: 2, clientY: 100 });
    fireEvent.pointerMove(lista, { pointerId: 2, clientY: 400 });
    fireEvent.pointerUp(lista, { pointerId: 2, clientY: 400 });

    expect(abertura.get()).toBe(1);
    expect(props.aoFechar).not.toHaveBeenCalled();
  });

  it("para cima não passa de aberto", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const abertura = motionValue(1);
    montar({ abertura });

    fireEvent.pointerDown(punho(), { pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(punho(), { pointerId: 1, clientY: 100 });

    expect(abertura.get()).toBe(1);
  });
});

describe("fechar", () => {
  it("pelo X, que tem nome acessível", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const { props } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Fechar comentários" }));
    expect(props.aoFechar).toHaveBeenCalledTimes(1);
  });

  it("pelo Esc", () => {
    acoes.carregarComentarios.mockReturnValue(new Promise(() => {}));
    const { props } = montar();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.aoFechar).toHaveBeenCalledTimes(1);
  });
});

describe("troca de episódio com o painel aberto", () => {
  it("o painel continua, e a conversa passa a ser do episódio novo", async () => {
    acoes.carregarComentarios.mockImplementation(async (id: string) => ({
      ok: true,
      comentarios: [comentario(`${id}-c`, `Sobre o ${id}`)],
    }));
    const { rerender, props } = montar();
    expect(await screen.findByText("Sobre o ep1")).toBeInTheDocument();
    const painel = screen.getByRole("dialog");

    rerender(<Comentarios {...props} lamina={lamina(2)} />);

    // O mesmo painel — não desmontou —, agora contando o episódio 2.
    expect(screen.getByRole("dialog")).toBe(painel);
    expect(screen.getByText("Ep 2")).toBeInTheDocument();
    expect(await screen.findByText("Sobre o ep2")).toBeInTheDocument();
    expect(screen.queryByText("Sobre o ep1")).toBeNull();
    expect(acoes.carregarComentarios).toHaveBeenLastCalledWith("ep2");
  });
});
