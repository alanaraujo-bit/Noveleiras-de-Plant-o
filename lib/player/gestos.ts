"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gestos da lâmina do reel.
 *
 * Quatro intenções dividem a mesma superfície de toque, e é por isso que isto
 * é uma máquina de estados explícita em vez de três `onClick` soltos:
 *
 * - **toque** — pausa e retoma;
 * - **toque duplo à esquerda / à direita** — recua e avança cinco segundos;
 * - **toque duplo ao centro** — curte;
 * - **pressão longa** — dobra a velocidade enquanto o dedo estiver na tela.
 *
 * As três primeiras se distinguem por *quando* e *onde* o dedo levanta; a
 * quarta, por quanto tempo ele fica. Um reconhecedor ingênuo erra todas as
 * fronteiras: o primeiro toque de um toque duplo pausa o vídeo antes de o
 * segundo chegar, soltar o dedo depois de uma pressão longa conta como toque e
 * pausa, e um deslize para a próxima lâmina vira um toque acidental porque o
 * dedo subiu dentro do mesmo elemento.
 *
 * Todas essas fronteiras estão codificadas abaixo, cada uma com o motivo.
 */

/** Tempo com o dedo parado a partir do qual a pressão longa começa. */
const PRESSAO_LONGA_MS = 350;
/** Janela entre dois toques para valerem como toque duplo. */
const TOQUE_DUPLO_MS = 280;
/** Movimento acima disto deixa de ser toque e passa a ser rolagem. */
const TOLERANCIA_DE_MOVIMENTO_PX = 12;
/** Segundos por toque duplo. */
export const SALTO_SEG = 5;
/** Velocidade da pressão longa. */
const VELOCIDADE_TURBO = 2;
/** Tempo que o aviso de salto acumulado permanece somando. */
const JANELA_DE_ACUMULO_MS = 750;

export type LadoDoSalto = "tras" | "frente";

export type AvisoDeSalto = {
  /** Muda a cada salto para reiniciar a animação. */
  chave: number;
  lado: LadoDoSalto;
  /** Total acumulado na sequência atual, em segundos. */
  segundos: number;
};

type Zona = "esquerda" | "centro" | "direita";

/** Larguras relativas das zonas. O centro é menor: curtir tem botão próprio. */
const FATIA_LATERAL = 0.35;

export function useGestosDoReel({
  videoRef,
  duracaoPadraoSec,
  habilitado,
  aoAlternarPlay,
  aoCurtir,
  aoSaltar,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duracaoPadraoSec: number;
  /** Falso em lâmina bloqueada ou com erro: ali não há o que controlar. */
  habilitado: boolean;
  aoAlternarPlay: () => void;
  aoCurtir: () => void;
  /** Chamado a cada salto efetivado, para telemetria. */
  aoSaltar?: (segundos: number) => void;
}) {
  const [turbo, setTurbo] = useState(false);
  const [aviso, setAviso] = useState<AvisoDeSalto | null>(null);

  // Um único dedo comanda. Os demais são ignorados até ele sair — sem isso,
  // um gesto de pinça ou a mão apoiada na tela cancelaria a pressão longa.
  const dedoRef = useRef<number | null>(null);
  const inicioRef = useRef({ x: 0, y: 0, zona: "centro" as Zona });
  const moveuRef = useRef(false);
  const relogioPressaoRef = useRef<number | null>(null);
  const emPressaoRef = useRef(false);

  const ultimoToqueRef = useRef(0);
  const relogioToqueRef = useRef<number | null>(null);
  const acumuladoRef = useRef({ lado: "frente" as LadoDoSalto, segundos: 0 });
  const relogioAcumuloRef = useRef<number | null>(null);
  const chaveRef = useRef(0);

  const limparRelogios = useCallback(() => {
    if (relogioPressaoRef.current) window.clearTimeout(relogioPressaoRef.current);
    if (relogioToqueRef.current) window.clearTimeout(relogioToqueRef.current);
    relogioPressaoRef.current = null;
    relogioToqueRef.current = null;
  }, []);

  // ------------------------------------------------------------- turbo

  const aplicarVelocidade = useCallback(
    (valor: number) => {
      const video = videoRef.current;
      if (!video) return;
      // `preservesPitch` explícito: sem ele alguns navegadores sobem o tom da
      // voz junto com a velocidade, e a novela vira desenho animado.
      video.preservesPitch = true;
      video.playbackRate = valor;
    },
    [videoRef],
  );

  const ligarTurbo = useCallback(() => {
    const video = videoRef.current;
    // Acelerar um vídeo parado não significa nada — e sair da pressão longa
    // devolveria a velocidade a um vídeo que continua parado.
    if (!video || video.paused) return;
    emPressaoRef.current = true;
    aplicarVelocidade(VELOCIDADE_TURBO);
    setTurbo(true);
  }, [aplicarVelocidade, videoRef]);

  const desligarTurbo = useCallback(() => {
    if (!emPressaoRef.current) return;
    emPressaoRef.current = false;
    aplicarVelocidade(1);
    setTurbo(false);
  }, [aplicarVelocidade]);

  // A velocidade é estado do elemento de vídeo, não do React: se a lâmina sair
  // de cena, for desmontada ou trocar de fonte com o dedo ainda na tela, ela
  // ficaria em 2x para sempre. Este efeito é a rede de segurança.
  useEffect(() => {
    if (habilitado) return;
    desligarTurbo();
  }, [habilitado, desligarTurbo]);

  useEffect(
    () => () => {
      if (relogioPressaoRef.current) window.clearTimeout(relogioPressaoRef.current);
      if (relogioToqueRef.current) window.clearTimeout(relogioToqueRef.current);
      if (relogioAcumuloRef.current) window.clearTimeout(relogioAcumuloRef.current);
      const video = videoRef.current;
      if (video) video.playbackRate = 1;
    },
    [videoRef],
  );

  // -------------------------------------------------------------- salto

  const saltar = useCallback(
    (lado: LadoDoSalto) => {
      const video = videoRef.current;
      if (!video) return;

      const delta = lado === "frente" ? SALTO_SEG : -SALTO_SEG;
      const duracao =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : duracaoPadraoSec;

      // Limite nos dois extremos. Sem isso, `currentTime` negativo é ignorado
      // por uns navegadores e lança em outros, e passar da duração dispara o
      // fim do episódio — que no reel avança de lâmina sozinho.
      const alvo = Math.min(
        Math.max(0, video.currentTime + delta),
        Math.max(0, duracao - 0.25),
      );
      video.currentTime = alvo;

      // Toques seguidos somam: quatro toques no mesmo lado andam vinte
      // segundos, e o aviso mostra o total, não a última parcela.
      const mesmoLado = acumuladoRef.current.lado === lado;
      acumuladoRef.current = {
        lado,
        segundos: (mesmoLado ? acumuladoRef.current.segundos : 0) + SALTO_SEG,
      };
      chaveRef.current += 1;
      setAviso({
        chave: chaveRef.current,
        lado,
        segundos: acumuladoRef.current.segundos,
      });

      if (relogioAcumuloRef.current) window.clearTimeout(relogioAcumuloRef.current);
      relogioAcumuloRef.current = window.setTimeout(() => {
        acumuladoRef.current = { lado, segundos: 0 };
        setAviso(null);
      }, JANELA_DE_ACUMULO_MS);

      aoSaltar?.(delta);
    },
    [aoSaltar, duracaoPadraoSec, videoRef],
  );

  // ------------------------------------------------------------ ponteiro

  const aoDescer = useCallback(
    (evento: React.PointerEvent<HTMLElement>) => {
      if (!habilitado) return;
      if (dedoRef.current !== null) return;

      dedoRef.current = evento.pointerId;
      moveuRef.current = false;

      const caixa = evento.currentTarget.getBoundingClientRect();
      const relativo = (evento.clientX - caixa.left) / (caixa.width || 1);
      inicioRef.current = {
        x: evento.clientX,
        y: evento.clientY,
        zona:
          relativo < FATIA_LATERAL
            ? "esquerda"
            : relativo > 1 - FATIA_LATERAL
              ? "direita"
              : "centro",
      };

      relogioPressaoRef.current = window.setTimeout(() => {
        relogioPressaoRef.current = null;
        if (!moveuRef.current) ligarTurbo();
      }, PRESSAO_LONGA_MS);
    },
    [habilitado, ligarTurbo],
  );

  const aoMover = useCallback((evento: React.PointerEvent<HTMLElement>) => {
    if (evento.pointerId !== dedoRef.current) return;
    if (moveuRef.current) return;

    const dx = evento.clientX - inicioRef.current.x;
    const dy = evento.clientY - inicioRef.current.y;
    if (Math.hypot(dx, dy) <= TOLERANCIA_DE_MOVIMENTO_PX) return;

    // O dedo saiu do lugar: isto virou rolagem. Cancela a pressão longa que
    // ainda não começou, mas não desliga a que já está valendo — quem segura
    // para acelerar costuma deslizar um pouco sem querer parar.
    moveuRef.current = true;
    if (relogioPressaoRef.current) {
      window.clearTimeout(relogioPressaoRef.current);
      relogioPressaoRef.current = null;
    }
  }, []);

  const aoSubir = useCallback(
    (evento: React.PointerEvent<HTMLElement>) => {
      if (evento.pointerId !== dedoRef.current) return;
      dedoRef.current = null;

      if (relogioPressaoRef.current) {
        window.clearTimeout(relogioPressaoRef.current);
        relogioPressaoRef.current = null;
      }

      // Soltar depois de acelerar não é um toque. Sem esta saída, toda pressão
      // longa terminaria pausando o vídeo.
      if (emPressaoRef.current) {
        desligarTurbo();
        return;
      }
      // Nem um deslize que por acaso terminou aqui dentro.
      if (moveuRef.current) return;

      const agora = Date.now();
      const zona = inicioRef.current.zona;
      const dentroDaJanela = agora - ultimoToqueRef.current < TOQUE_DUPLO_MS;
      ultimoToqueRef.current = agora;

      if (dentroDaJanela) {
        // O segundo toque cancela a pausa que o primeiro havia agendado.
        if (relogioToqueRef.current) {
          window.clearTimeout(relogioToqueRef.current);
          relogioToqueRef.current = null;
        }
        if (zona === "esquerda") saltar("tras");
        else if (zona === "direita") saltar("frente");
        else aoCurtir();
        return;
      }

      // Primeiro toque: espera para saber se um segundo vem. É o preço de ter
      // duas ações no mesmo lugar, e 280ms é curto o bastante para a pausa
      // ainda parecer imediata.
      relogioToqueRef.current = window.setTimeout(() => {
        relogioToqueRef.current = null;
        aoAlternarPlay();
      }, TOQUE_DUPLO_MS);
    },
    [aoAlternarPlay, aoCurtir, desligarTurbo, saltar],
  );

  const aoCancelar = useCallback(
    (evento: React.PointerEvent<HTMLElement>) => {
      if (evento.pointerId !== dedoRef.current) return;
      // O navegador tomou o gesto para si (rolagem, gesto do sistema). Nada
      // do que estava pendente vale mais.
      dedoRef.current = null;
      moveuRef.current = true;
      limparRelogios();
      desligarTurbo();
    },
    [desligarTurbo, limparRelogios],
  );

  /**
   * Teclado.
   *
   * Um clique gerado pelo teclado chega com `detail === 0`; um clique de
   * ponteiro, com 1 ou mais. É assim que o mesmo elemento serve os dois sem
   * disparar a ação duas vezes.
   */
  const aoClicar = useCallback(
    (evento: React.MouseEvent<HTMLElement>) => {
      if (evento.detail !== 0) return;
      aoAlternarPlay();
    },
    [aoAlternarPlay],
  );

  return {
    turbo,
    aviso,
    manipuladores: {
      onPointerDown: aoDescer,
      onPointerMove: aoMover,
      onPointerUp: aoSubir,
      onPointerCancel: aoCancelar,
      onPointerLeave: aoCancelar,
      onClick: aoClicar,
      // A pressão longa abre o menu de contexto no celular e a lupa de seleção
      // no iOS; os dois roubam o gesto no meio.
      onContextMenu: (evento: React.MouseEvent) => evento.preventDefault(),
    },
  };
}
