"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";

import { IconeFechar } from "@/components/ui/icones";

/**
 * Folha inferior (bottom sheet).
 *
 * Sobe do rodapé como em aplicativo nativo, trava o rolamento do fundo,
 * fecha com Esc, com toque fora e arrastando para baixo, e devolve o foco a
 * quem a abriu.
 */
export function Folha({
  aberta,
  aoFechar,
  titulo,
  children,
}: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  const painelRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberta) return;
    focoAnteriorRef.current = document.activeElement as HTMLElement | null;

    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);

    const primeiro = painelRef.current?.querySelector<HTMLElement>(
      "textarea, input, button",
    );
    primeiro?.focus();

    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener("keydown", aoTeclar);
      focoAnteriorRef.current?.focus?.();
    };
  }, [aberta, aoFechar]);

  return (
    <AnimatePresence>
      {aberta ? (
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={titulo}>
          <motion.button
            type="button"
            aria-label="Fechar"
            onClick={aoFechar}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-950/70 backdrop-blur-[2px]"
          />
          <motion.div
            ref={painelRef}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_evento, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) aoFechar();
            }}
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-sheet border-t border-white/10 bg-ink-850"
            style={{ paddingBottom: "calc(var(--safe-b) + 1.25rem)" }}
          >
            <div className="sticky top-0 z-10 bg-ink-850/95 px-5 pb-3 pt-2.5 backdrop-blur-sm">
              <span
                aria-hidden
                className="mx-auto mb-3 block h-1 w-10 rounded-full bg-white/20"
              />
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[1.25rem] leading-tight">{titulo}</h2>
                <button
                  type="button"
                  onClick={aoFechar}
                  aria-label="Fechar"
                  className="tap grid size-9 place-items-center rounded-full text-cream-400 hover:bg-white/8"
                >
                  <IconeFechar tamanho={18} />
                </button>
              </div>
            </div>
            <div className="px-5">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
