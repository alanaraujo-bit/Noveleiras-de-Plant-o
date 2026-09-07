"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { IconeFechar } from "@/components/ui/icones";

/**
 * O trailer, em tela cheia sobre a página.
 *
 * Não usa a `Folha` de propósito, embora herde o comportamento dela (Esc,
 * trava de rolagem, devolução do foco): o trailer é vertical, como a novela, e
 * numa folha ele perderia altura para o cabeçalho justamente onde a tela é
 * mais estreita. Além disso a folha se fecha arrastando para baixo, gesto que
 * disputaria com a barra de progresso do vídeo — o espectador tentaria buscar
 * um trecho e fecharia o trailer.
 *
 * Não registra progresso. Assistir ao trailer não é assistir ao episódio: não
 * há `onTimeUpdate`, nem chamada de ação, nem episódio a que se referir.
 */
export function PlayerTrailer({
  aberto,
  aoFechar,
  url,
  poster,
  titulo,
}: {
  aberto: boolean;
  aoFechar: () => void;
  url: string;
  poster: string | null;
  titulo: string;
}) {
  const focoAnteriorRef = useRef<HTMLElement | null>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const [falhou, setFalhou] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!aberto) return;
    // Cada abertura recomeça limpa: um erro da vez anterior não pode
    // condenar a tentativa seguinte.
    setFalhou(false);
    setCarregando(true);

    focoAnteriorRef.current = document.activeElement as HTMLElement | null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    // O foco entra no diálogo para que o leitor de tela anuncie onde está e
    // para que o Tab não escape para a página atrás.
    fecharRef.current?.focus();

    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener("keydown", aoTeclar);
      focoAnteriorRef.current?.focus?.();
    };
  }, [aberto, aoFechar]);

  return (
    <AnimatePresence>
      {aberto ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Trailer de ${titulo}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950"
        >
          {/* Tocar fora do vídeo fecha, como em galeria de fotos. Fica atrás
              do vídeo para não roubar o toque dos controles. */}
          <button
            type="button"
            aria-label="Fechar trailer"
            tabIndex={-1}
            onClick={aoFechar}
            className="absolute inset-0 cursor-default"
          />

          {falhou ? (
            <div className="relative mx-8 text-center">
              <p className="text-[0.9375rem] font-semibold text-cream-100">
                Não consegui carregar o trailer.
              </p>
              <p className="mt-1 text-[0.8125rem] text-cream-400">
                Pode ser a conexão. Os episódios continuam disponíveis.
              </p>
            </div>
          ) : (
            <div className="relative max-h-[100dvh] w-full max-w-[min(100vw,calc(100dvh*9/16))]">
              {carregando ? (
                <span
                  aria-hidden
                  className="absolute inset-0 grid place-items-center text-[0.8125rem] text-cream-400"
                >
                  Carregando…
                </span>
              ) : null}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                data-testid="video-trailer"
                src={url}
                poster={poster ?? undefined}
                controls
                autoPlay
                playsInline
                onCanPlay={() => setCarregando(false)}
                onError={() => {
                  setFalhou(true);
                  setCarregando(false);
                }}
                className="relative aspect-[9/16] max-h-[100dvh] w-full bg-black"
              />
            </div>
          )}

          <button
            ref={fecharRef}
            type="button"
            onClick={aoFechar}
            aria-label="Fechar trailer"
            className="tap absolute right-4 grid size-11 place-items-center rounded-full bg-ink-950/70 text-cream-100 backdrop-blur-sm"
            style={{ top: "calc(var(--safe-t) + 0.25rem)" }}
          >
            <IconeFechar tamanho={20} />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
