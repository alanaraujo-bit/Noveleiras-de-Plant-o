"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatClock } from "@/lib/format";

/**
 * Barra de progresso navegável da lâmina.
 *
 * Um reel não tem player com controles, então esta linha acumula duas funções
 * que normalmente moram em lugares diferentes: mostrar onde o episódio está e
 * deixar ir para outro ponto. Isso cria três tensões, e cada uma tem uma
 * decisão explícita aqui.
 *
 * 1. **Alvo de toque contra área de gesto.** Dois pixels de altura são
 *    impossíveis de acertar com o polegar, mas engordar a barra roubaria a
 *    faixa onde o toque duplo salta. A solução é a de sempre em interface
 *    móvel: a barra continua fina, e um alvo invisível de 22px por cima
 *    recebe o dedo.
 *
 * 2. **Arrastar contra deslizar.** O trilho do reel rola na vertical. Se esta
 *    barra capturasse todo movimento, um swipe iniciado por acidente sobre ela
 *    prenderia a pessoa na lâmina. Por isso a captura só acontece depois de o
 *    dedo andar na horizontal mais do que na vertical — antes disso o gesto
 *    ainda pode virar rolagem.
 *
 * 3. **Posição do vídeo contra posição do dedo.** Durante o arrasto quem manda
 *    é o dedo: o vídeo continua emitindo `timeupdate` do ponto antigo, e deixar
 *    esse valor pintar a barra faria a alça tremer para trás a cada quadro.
 */

/** Altura da faixa invisível que recebe o toque. */
const ALVO_PX = 22;

/**
 * Folga entre a barra e a barra de abas.
 *
 * Não é estética: `--tabbar-h` descreve a altura do conteúdo das abas, mas o
 * elemento tem uma borda superior de 1px por cima disso, então a barra de abas
 * ocupa um pixel a mais do que a variável diz. Encostar nela deixava a metade
 * de baixo do alvo — e do próprio traço — sob um elemento `fixed` com z-50, e
 * o dedo caía na aba em vez de na barra. Quatro pixels resolvem a borda e ainda
 * dão respiro ao traço.
 */
const FOLGA_PX = 4;

export function BarraDeProgresso({
  posicaoSec,
  duracaoSec,
  accent,
  habilitada,
  recuada = false,
  aoNavegar,
  aoArrastarMudar,
}: {
  posicaoSec: number;
  duracaoSec: number;
  accent: string;
  /** Falsa em lâmina bloqueada, com erro ou fora de cena. */
  habilitada: boolean;
  /** Sai de cena junto com o resto da interface, sem deixar de existir. */
  recuada?: boolean;
  /** Chamado ao soltar, com o segundo de destino. */
  aoNavegar: (segundos: number) => void;
  /** Avisa o pai que um arrasto começou ou terminou. */
  aoArrastarMudar?: (arrastando: boolean) => void;
}) {
  const trilhoRef = useRef<HTMLDivElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [fracaoDoDedo, setFracaoDoDedo] = useState(0);

  const dedoRef = useRef<number | null>(null);
  const inicioRef = useRef({ x: 0, y: 0 });
  const capturouRef = useRef(false);

  const duracao = duracaoSec > 0 ? duracaoSec : 1;
  const fracaoDoVideo = Math.min(1, Math.max(0, posicaoSec / duracao));
  const fracao = arrastando ? fracaoDoDedo : fracaoDoVideo;

  const fracaoNoPonto = useCallback((clientX: number) => {
    const caixa = trilhoRef.current?.getBoundingClientRect();
    if (!caixa || caixa.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - caixa.left) / caixa.width));
  }, []);

  const terminar = useCallback(
    (clientX: number | null) => {
      if (!capturouRef.current) return;
      capturouRef.current = false;
      setArrastando(false);
      aoArrastarMudar?.(false);
      if (clientX !== null) aoNavegar(fracaoNoPonto(clientX) * duracao);
    },
    [aoArrastarMudar, aoNavegar, duracao, fracaoNoPonto],
  );

  const aoDescer = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      if (!habilitada || dedoRef.current !== null) return;
      dedoRef.current = evento.pointerId;
      inicioRef.current = { x: evento.clientX, y: evento.clientY };
      capturouRef.current = false;
      // Sem `preventDefault` e sem captura aqui: enquanto a intenção for
      // ambígua, o gesto ainda pertence ao trilho de rolagem.
    },
    [habilitada],
  );

  const aoMover = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      if (evento.pointerId !== dedoRef.current) return;

      if (!capturouRef.current) {
        const dx = evento.clientX - inicioRef.current.x;
        const dy = evento.clientY - inicioRef.current.y;
        // A intenção só é horizontal quando o dedo andou o suficiente E andou
        // mais para o lado do que para cima. Um limiar de distância sozinho
        // capturaria o começo de um swipe vertical.
        if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return;

        capturouRef.current = true;
        setArrastando(true);
        aoArrastarMudar?.(true);

        // Só agora o ponteiro é nosso: a partir daqui o dedo pode sair do
        // elemento sem que o arrasto se perca.
        //
        // O `try` não é decoração. `setPointerCapture` **lança** quando o id
        // não corresponde a um ponteiro ativo — acontece com evento sintético,
        // com ponteiro já liberado pelo sistema e em navegador que entregou o
        // `pointerdown` mas perdeu o rastro depois. Sem o `catch`, a exceção
        // aborta o resto do handler e o arrasto morre no primeiro movimento,
        // com a barra travada em "arrastando" e o vídeo intocado. A captura é
        // uma conveniência; a navegação funciona sem ela.
        try {
          evento.currentTarget.setPointerCapture?.(evento.pointerId);
        } catch {
          /* seguimos sem captura: os eventos ainda chegam enquanto o dedo
             estiver sobre o alvo. */
        }
      }

      // `cancelable` é falso em evento sintético e em alguns gestos já
      // consumidos pelo navegador; chamar `preventDefault` ali só gera um
      // aviso no console.
      if (evento.cancelable) evento.preventDefault();
      setFracaoDoDedo(fracaoNoPonto(evento.clientX));
    },
    [aoArrastarMudar, fracaoNoPonto],
  );

  const aoSubir = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      if (evento.pointerId !== dedoRef.current) return;
      dedoRef.current = null;
      terminar(capturouRef.current ? evento.clientX : null);
    },
    [terminar],
  );

  const aoCancelar = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      if (evento.pointerId !== dedoRef.current) return;
      dedoRef.current = null;
      // Cancelado pelo sistema: a posição do dedo não é confiável, então o
      // vídeo fica onde estava em vez de saltar para um ponto arbitrário.
      terminar(null);
    },
    [terminar],
  );

  // Rede de segurança: se a lâmina sair de cena com o dedo na tela, o arrasto
  // precisa acabar — senão a barra fica presa mostrando a posição do dedo.
  useEffect(() => {
    if (habilitada) return;
    dedoRef.current = null;
    if (capturouRef.current) {
      capturouRef.current = false;
      setArrastando(false);
      aoArrastarMudar?.(false);
    }
  }, [habilitada, aoArrastarMudar]);

  const segundosMostrados = arrastando ? fracaoDoDedo * duracao : posicaoSec;

  return (
    <div
      className={`absolute inset-x-0 z-30 transition-opacity duration-300 ${
        recuada ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{
        // O alvo cresce para **cima** a partir do topo da barra de abas, nunca
        // centrado nela. A barra de abas é `fixed` com z-50 e cobriria a metade
        // de baixo de um alvo centrado — o dedo cairia na aba em vez de na
        // linha, e o arrasto simplesmente não começaria.
        bottom: `calc(var(--tabbar-h) + var(--safe-b) + ${FOLGA_PX}px)`,
        height: ALVO_PX,
        // Cede a rolagem vertical ao trilho e retém a horizontal, que é nossa.
        touchAction: "pan-y",
      }}
      onPointerDown={aoDescer}
      onPointerMove={aoMover}
      onPointerUp={aoSubir}
      onPointerCancel={aoCancelar}
    >
      {/* Relógio: só durante o arrasto. Fixo, ele seria mais um número
          competindo com a cena; ausente, a pessoa arrastaria às cegas. */}
      {arrastando ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-8 flex justify-center"
        >
          <span className="rounded-full bg-black/70 px-3 py-1.5 text-[0.8125rem] font-bold tabular-nums text-white backdrop-blur-sm">
            {formatClock(segundosMostrados)}
            <span className="font-medium text-white/50">
              {" / "}
              {formatClock(duracao)}
            </span>
          </span>
        </div>
      ) : null}

      <div
        ref={trilhoRef}
        role="slider"
        aria-label="Posição no episódio"
        aria-valuemin={0}
        aria-valuemax={Math.round(duracao)}
        aria-valuenow={Math.round(segundosMostrados)}
        aria-valuetext={`${formatClock(segundosMostrados)} de ${formatClock(duracao)}`}
        tabIndex={habilitada ? 0 : -1}
        onKeyDown={(evento) => {
          const passo =
            evento.key === "ArrowRight"
              ? 5
              : evento.key === "ArrowLeft"
                ? -5
                : evento.key === "PageUp"
                  ? 30
                  : evento.key === "PageDown"
                    ? -30
                    : null;
          if (passo === null && evento.key !== "Home" && evento.key !== "End") {
            return;
          }
          evento.preventDefault();
          const destino =
            evento.key === "Home"
              ? 0
              : evento.key === "End"
                ? duracao
                : Math.min(duracao, Math.max(0, posicaoSec + (passo ?? 0)));
          aoNavegar(destino);
        }}
        // A linha fica no rodapé do alvo — visualmente encostada na barra de
        // abas, como antes — enquanto a área que recebe o dedo se estende para
        // cima, onde não há nada disputando o toque.
        className="absolute inset-x-0 bottom-0 outline-offset-4"
        style={{ height: arrastando ? 4 : 2 }}
      >
        <div
          className="size-full overflow-hidden rounded-full bg-white/14 transition-[height] duration-150"
          style={{ height: "100%" }}
        >
          <div
            className={`h-full origin-left ${
              // A transição some durante o arrasto: interpolar a largura
              // enquanto o dedo se move deixa a barra atrás do dedo.
              arrastando ? "" : "transition-[width] duration-200 ease-linear"
            }`}
            style={{ width: `${fracao * 100}%`, background: accent }}
          />
        </div>

        {/* Alça: só existe durante o arrasto. Em repouso, um ponto permanente
            sobre o vídeo seria mais um elemento de interface disputando a
            cena — e a barra em repouso é informação, não controle. */}
        {arrastando ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_6px_rgb(0_0_0/0.5)]"
            style={{ left: `${fracao * 100}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}
