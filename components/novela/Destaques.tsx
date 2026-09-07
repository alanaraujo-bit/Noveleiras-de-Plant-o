"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Selo } from "@/components/ui/primitivos";
import { IconePlay, IconeSeta } from "@/components/ui/icones";
import { STATUS_LABEL, formatRating } from "@/lib/format";
import type { NovelaCard } from "@/lib/repositories/catalog";

/**
 * Destaques da Home: cartaz vertical inteiro, deslizável com o dedo.
 * O rolamento é do próprio navegador (scroll-snap) — nada de arrastar em JS,
 * o que mantém a inércia igual à do sistema.
 */
export function Destaques({ novelas }: { novelas: NovelaCard[] }) {
  const trilhoRef = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState(0);

  useEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const observer = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (entrada.isIntersecting) {
            const index = Number(
              (entrada.target as HTMLElement).dataset.index ?? 0,
            );
            setAtivo(index);
          }
        }
      },
      { root: trilho, threshold: 0.6 },
    );
    for (const filho of trilho.children) observer.observe(filho);
    return () => observer.disconnect();
  }, [novelas.length]);

  if (novelas.length === 0) return null;

  return (
    <section aria-label="Destaques do plantão">
      <div
        ref={trilhoRef}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
      >
        {novelas.map((novela, index) => (
          <article
            key={novela.id}
            data-index={index}
            className="w-full shrink-0 snap-center px-5"
          >
            {/* 3:4 mantém o cartaz imponente sem empurrar "continuar
                assistindo" para fora da primeira dobra. */}
            <div
              className="relative overflow-hidden rounded-panel border border-white/8"
              style={{ aspectRatio: "3 / 4" }}
            >
              <img
                src={novela.heroUrl}
                alt=""
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                className="absolute inset-0 size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/35 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 p-5">
                <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                  <Selo tom="ouro">
                    {novela.status === "COMING_SOON"
                      ? "Estreia em breve"
                      : "Destaque do plantão"}
                  </Selo>
                  {novela.accessTier === "PREMIUM" ? (
                    <Selo tom="carmim">Premium</Selo>
                  ) : (
                    <Selo tom="jade">Grátis</Selo>
                  )}
                </div>

                <h2 className="text-[1.875rem] leading-[1.05] text-balance-pt">
                  {novela.title}
                </h2>
                <p className="selectable mt-2 line-clamp-2 text-[0.875rem] leading-relaxed text-cream-200">
                  {novela.tagline}
                </p>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] font-medium text-cream-400">
                  {novela.rating > 0 ? (
                    <>
                      <span className="text-gold-400">★ {formatRating(novela.rating)}</span>
                      <span aria-hidden>·</span>
                    </>
                  ) : null}
                  <span>{STATUS_LABEL[novela.status]}</span>
                  <span aria-hidden>·</span>
                  <span>{novela.episodeCount} episódios</span>
                  <span aria-hidden>·</span>
                  <span className="rounded border border-white/20 px-1">
                    {novela.ageRating}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-2.5">
                  <Link
                    href={`/novela/${novela.slug}`}
                    className="tap inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-cream-50 text-[0.9375rem] font-bold tracking-tight text-ink-950"
                  >
                    <IconePlay tamanho={17} />
                    {novela.status === "COMING_SOON" ? "Ver detalhes" : "Assistir"}
                  </Link>
                  <Link
                    href={`/novela/${novela.slug}`}
                    aria-label={`Mais sobre ${novela.title}`}
                    className="tap grid size-12 place-items-center rounded-2xl border border-white/14 bg-white/8 text-cream-200"
                  >
                    <IconeSeta tamanho={19} />
                  </Link>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {novelas.length > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-1.5" aria-hidden>
          {novelas.map((novela, index) => (
            <span
              key={novela.id}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: index === ativo ? "1.125rem" : "0.3125rem",
                background:
                  index === ativo
                    ? "var(--color-rose-500)"
                    : "rgb(255 255 255 / 0.22)",
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
