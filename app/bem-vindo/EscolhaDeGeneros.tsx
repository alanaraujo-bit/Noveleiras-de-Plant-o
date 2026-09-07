"use client";

import { useState, useTransition } from "react";

import { concluirOnboarding } from "@/lib/actions/conta";
import { IconeCheck } from "@/components/ui/icones";
import type { GenreSummary } from "@/lib/repositories/catalog";

/**
 * Segundo momento do onboarding: a pessoa diz o que gosta e a Home nasce
 * personalizada. Escolher é opcional — dá para seguir sem marcar nada.
 */
export function EscolhaDeGeneros({
  nome,
  generos,
}: {
  nome: string;
  generos: GenreSummary[];
}) {
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [enviando, iniciar] = useTransition();

  const alternar = (id: string) => {
    setEscolhidos((atual) =>
      atual.includes(id)
        ? atual.filter((item) => item !== id)
        : [...atual, id].slice(0, 8),
    );
  };

  const concluir = () => {
    iniciar(async () => {
      await concluirOnboarding(escolhidos);
    });
  };

  return (
    <div
      className="flex min-h-[100dvh] flex-col"
      style={{ paddingTop: "calc(var(--safe-t) + 1.75rem)" }}
    >
      <header className="px-6">
        <p className="eyebrow">Falta só isto, {nome.split(" ")[0]}</p>
        <h1 className="mt-2 text-[1.875rem] leading-[1.08] text-balance-pt">
          Que tipo de drama combina com você?
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-cream-400">
          Escolha quantos quiser. Serve para montar sua Home — e você muda isso
          quando bem entender.
        </p>
      </header>

      <div className="mt-6 flex-1 px-6">
        <ul className="grid grid-cols-2 gap-2.5">
          {generos.map((genero) => {
            const ativo = escolhidos.includes(genero.id);
            return (
              <li key={genero.id}>
                <button
                  type="button"
                  onClick={() => alternar(genero.id)}
                  aria-pressed={ativo}
                  className="tap relative w-full overflow-hidden rounded-card border p-3.5 text-left transition-colors"
                  style={{
                    aspectRatio: "5 / 4",
                    borderColor: ativo
                      ? genero.accent
                      : "rgb(255 255 255 / 0.09)",
                    background: ativo
                      ? `linear-gradient(160deg, color-mix(in oklab, ${genero.accent} 42%, #130810), #1a0c15)`
                      : "linear-gradient(160deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.015))",
                  }}
                >
                  <span className="flex h-full flex-col justify-end">
                    <span className="font-display text-[1.0625rem] font-semibold leading-tight text-cream-50">
                      {genero.name}
                    </span>
                    <span className="mt-1 line-clamp-2 text-[0.75rem] leading-snug text-cream-400">
                      {genero.tagline}
                    </span>
                  </span>
                  {ativo ? (
                    <span
                      className="absolute right-2.5 top-2.5 grid size-6 place-items-center rounded-full text-ink-950"
                      style={{ background: genero.accent }}
                    >
                      <IconeCheck tamanho={14} />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        className="sticky bottom-0 mt-6 border-t border-white/8 bg-ink-950/92 px-6 pt-4 backdrop-blur-xl"
        style={{ paddingBottom: "calc(var(--safe-b) + 1rem)" }}
      >
        <button
          type="button"
          onClick={concluir}
          disabled={enviando}
          className="tap flex h-13 w-full items-center justify-center rounded-2xl bg-rose-600 text-[0.9375rem] font-bold tracking-tight text-cream-50 disabled:opacity-60"
        >
          {enviando
            ? "Montando sua Home…"
            : escolhidos.length === 0
              ? "Entrar sem escolher"
              : `Entrar com ${escolhidos.length} ${
                  escolhidos.length === 1 ? "gênero" : "gêneros"
                }`}
        </button>
      </div>
    </div>
  );
}
