import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SALTO_SEG, useGestosDoReel } from "./gestos";

/**
 * O reconhecedor de gestos é um relógio disfarçado de interface: tudo o que ele
 * decide depende de quanto tempo passou entre descer e subir o dedo, e de onde.
 * Testar isso pela tela seria testar o `setTimeout` do navegador — aqui o tempo
 * é controlado, e cada teste fixa uma fronteira que já deu errado ou daria.
 */

const LARGURA = 400;

function videoFalso(sobre: Partial<HTMLVideoElement> = {}) {
  return {
    paused: false,
    duration: 100,
    currentTime: 50,
    playbackRate: 1,
    preservesPitch: true,
    ...sobre,
  } as HTMLVideoElement;
}

/** Um ponteiro com a geometria que o reconhecedor lê para achar a zona. */
function ponteiro(x: number, y = 400, pointerId = 1) {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, width: LARGURA }),
    },
  } as unknown as React.PointerEvent<HTMLElement>;
}

function montar(video: HTMLVideoElement, sobre: Record<string, unknown> = {}) {
  const aoAlternarPlay = vi.fn();
  const aoCurtir = vi.fn();
  const aoSaltar = vi.fn();
  const videoRef = { current: video };

  const utils = renderHook(
    (props: { habilitado: boolean }) =>
      useGestosDoReel({
        videoRef,
        duracaoPadraoSec: 100,
        habilitado: props.habilitado,
        aoAlternarPlay,
        aoCurtir,
        aoSaltar,
        ...sobre,
      }),
    { initialProps: { habilitado: true } },
  );

  return { ...utils, aoAlternarPlay, aoCurtir, aoSaltar, video };
}

/** Um toque completo: desce e sobe sem mover. */
function tocar(
  resultado: { current: ReturnType<typeof useGestosDoReel> },
  x: number,
) {
  act(() => {
    resultado.current.manipuladores.onPointerDown(ponteiro(x));
    resultado.current.manipuladores.onPointerUp(ponteiro(x));
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("toque simples", () => {
  test("pausa só depois da janela de toque duplo", () => {
    const { result, aoAlternarPlay } = montar(videoFalso());

    tocar(result, 200);
    // Agir aqui seria o bug clássico: o primeiro toque de um toque duplo
    // pausaria o vídeo no meio do gesto.
    expect(aoAlternarPlay).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(300));
    expect(aoAlternarPlay).toHaveBeenCalledTimes(1);
  });
});

describe("toque duplo", () => {
  test("na direita avança e não pausa", () => {
    const { result, aoAlternarPlay, video } = montar(videoFalso());

    tocar(result, 380);
    tocar(result, 380);
    act(() => void vi.advanceTimersByTime(400));

    expect(video.currentTime).toBe(50 + SALTO_SEG);
    // A pausa agendada pelo primeiro toque precisa ter sido cancelada.
    expect(aoAlternarPlay).not.toHaveBeenCalled();
  });

  test("na esquerda recua", () => {
    const { result, video } = montar(videoFalso());
    tocar(result, 20);
    tocar(result, 20);
    expect(video.currentTime).toBe(50 - SALTO_SEG);
  });

  test("no centro curte, sem mexer no tempo", () => {
    const { result, aoCurtir, video } = montar(videoFalso());
    tocar(result, 200);
    tocar(result, 200);
    expect(aoCurtir).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(50);
  });

  test("dois toques lentos são dois toques simples, não um duplo", () => {
    const { result, aoAlternarPlay, video } = montar(videoFalso());

    tocar(result, 380);
    act(() => void vi.advanceTimersByTime(400));
    tocar(result, 380);
    act(() => void vi.advanceTimersByTime(400));

    expect(video.currentTime).toBe(50);
    expect(aoAlternarPlay).toHaveBeenCalledTimes(2);
  });

  test("toques seguidos acumulam e o aviso mostra o total", () => {
    const { result, video } = montar(videoFalso());

    tocar(result, 380);
    tocar(result, 380);
    expect(result.current.aviso?.segundos).toBe(5);

    tocar(result, 380);
    expect(video.currentTime).toBe(60);
    expect(result.current.aviso?.segundos).toBe(10);

    // Trocar de lado recomeça a contagem: "10s para trás" depois de dez para
    // frente seria uma leitura falsa do que aconteceu.
    tocar(result, 20);
    expect(result.current.aviso?.lado).toBe("tras");
    expect(result.current.aviso?.segundos).toBe(5);
  });
});

describe("limites do salto", () => {
  test("não passa do começo", () => {
    const { result, video } = montar(videoFalso({ currentTime: 2 }));
    tocar(result, 20);
    tocar(result, 20);
    // Um `currentTime` negativo é ignorado por uns navegadores e lança em
    // outros.
    expect(video.currentTime).toBe(0);
  });

  test("para antes do fim, para não disparar o próximo episódio", () => {
    const { result, video } = montar(videoFalso({ currentTime: 99 }));
    tocar(result, 380);
    tocar(result, 380);
    expect(video.currentTime).toBeLessThan(100);
    expect(video.currentTime).toBeCloseTo(99.75, 2);
  });

  test("duração desconhecida cai na duração declarada do episódio", () => {
    const { result, video } = montar(
      videoFalso({ duration: NaN, currentTime: 99 }),
    );
    tocar(result, 380);
    tocar(result, 380);
    expect(video.currentTime).toBeCloseTo(99.75, 2);
  });
});

describe("pressão longa", () => {
  test("dobra a velocidade e devolve ao soltar, sem pausar", () => {
    const { result, aoAlternarPlay, video } = montar(videoFalso());

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200));
      vi.advanceTimersByTime(400);
    });
    expect(video.playbackRate).toBe(2);
    expect(result.current.turbo).toBe(true);

    act(() => {
      result.current.manipuladores.onPointerUp(ponteiro(200));
      vi.advanceTimersByTime(400);
    });
    expect(video.playbackRate).toBe(1);
    expect(result.current.turbo).toBe(false);
    // Soltar depois de acelerar não é um toque — sem esta regra, toda pressão
    // longa terminaria pausando o vídeo.
    expect(aoAlternarPlay).not.toHaveBeenCalled();
  });

  test("mover o dedo antes do limiar vira rolagem, não turbo", () => {
    const { result, aoAlternarPlay, video } = montar(videoFalso());

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200, 400));
      result.current.manipuladores.onPointerMove(ponteiro(200, 300));
      vi.advanceTimersByTime(400);
    });
    expect(video.playbackRate).toBe(1);

    // E soltar depois de um deslize não pode contar como toque.
    act(() => {
      result.current.manipuladores.onPointerUp(ponteiro(200, 300));
      vi.advanceTimersByTime(400);
    });
    expect(aoAlternarPlay).not.toHaveBeenCalled();
  });

  test("vídeo pausado não acelera", () => {
    const { result, video } = montar(videoFalso({ paused: true }));
    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200));
      vi.advanceTimersByTime(400);
    });
    // Acelerar um vídeo parado não significa nada, e soltar devolveria a
    // velocidade a algo que continua parado.
    expect(video.playbackRate).toBe(1);
    expect(result.current.turbo).toBe(false);
  });

  test("um segundo dedo não cancela o gesto em curso", () => {
    const { result, video } = montar(videoFalso());

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200, 400, 1));
      // Mão apoiada na tela, ou o começo de uma pinça.
      result.current.manipuladores.onPointerDown(ponteiro(50, 400, 2));
      result.current.manipuladores.onPointerUp(ponteiro(50, 400, 2));
      vi.advanceTimersByTime(400);
    });
    expect(video.playbackRate).toBe(2);
  });

  test("cancelamento do sistema devolve a velocidade", () => {
    const { result, video } = montar(videoFalso());

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200));
      vi.advanceTimersByTime(400);
    });
    expect(video.playbackRate).toBe(2);

    act(() => result.current.manipuladores.onPointerCancel(ponteiro(200)));
    expect(video.playbackRate).toBe(1);
  });

  test("a lâmina sair de cena devolve a velocidade", () => {
    const { result, rerender, video } = montar(videoFalso());

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200));
      vi.advanceTimersByTime(400);
    });
    expect(video.playbackRate).toBe(2);

    // Swipe com o dedo ainda na tela: sem esta rede, a lâmina ficaria em 2x
    // para sempre, porque `playbackRate` é estado do elemento de vídeo.
    act(() => rerender({ habilitado: false }));
    expect(video.playbackRate).toBe(1);
    expect(result.current.turbo).toBe(false);
  });

  test("desmontar devolve a velocidade", () => {
    const { result, unmount, video } = montar(videoFalso());

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(200));
      vi.advanceTimersByTime(400);
    });
    act(() => unmount());
    expect(video.playbackRate).toBe(1);
  });
});

describe("lâmina desabilitada", () => {
  test("bloqueada ou com erro não responde a gesto", () => {
    const video = videoFalso();
    const aoAlternarPlay = vi.fn();
    const videoRef = { current: video };

    const { result } = renderHook(() =>
      useGestosDoReel({
        videoRef,
        duracaoPadraoSec: 100,
        habilitado: false,
        aoAlternarPlay,
        aoCurtir: vi.fn(),
      }),
    );

    act(() => {
      result.current.manipuladores.onPointerDown(ponteiro(380));
      result.current.manipuladores.onPointerUp(ponteiro(380));
      vi.advanceTimersByTime(400);
    });

    expect(aoAlternarPlay).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(50);
  });
});

describe("teclado", () => {
  test("clique de teclado alterna play; clique de ponteiro é ignorado aqui", () => {
    const { result, aoAlternarPlay } = montar(videoFalso());

    // `detail: 0` é como o navegador marca um clique vindo do teclado.
    act(() =>
      result.current.manipuladores.onClick({
        detail: 0,
      } as React.MouseEvent<HTMLElement>),
    );
    expect(aoAlternarPlay).toHaveBeenCalledTimes(1);

    // Um clique de ponteiro já foi tratado pelo fluxo de `pointerup`; agir de
    // novo dispararia a ação duas vezes.
    act(() =>
      result.current.manipuladores.onClick({
        detail: 1,
      } as React.MouseEvent<HTMLElement>),
    );
    expect(aoAlternarPlay).toHaveBeenCalledTimes(1);
  });
});
