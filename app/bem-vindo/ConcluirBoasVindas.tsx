"use client";

import { useTransition } from "react";

import { concluirOnboarding } from "@/lib/actions/conta";

export function ConcluirBoasVindas({ nome }: { nome: string }) {
  const [pendente, iniciar] = useTransition();

  return (
    <main
      className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-end px-6 pb-8"
      style={{ paddingBottom: "calc(var(--safe-b) + 2rem)" }}
    >
      <p className="eyebrow">Tudo pronto</p>
      <h1 className="mt-2.5 text-[2.125rem] leading-[1.06] text-balance-pt">
        Bem-vinda, {nome}
      </h1>
      <p className="mt-3.5 max-w-[24rem] text-[0.9375rem] leading-relaxed text-cream-200">
        Seu próximo capítulo começa agora.
      </p>
      <button
        type="button"
        disabled={pendente}
        onClick={() => iniciar(() => concluirOnboarding())}
        className="tap mt-7 flex h-13 w-full items-center justify-center rounded-2xl bg-cream-50 text-[0.9375rem] font-bold tracking-tight text-ink-950 disabled:opacity-60"
      >
        {pendente ? "Abrindo o Plantão…" : "Ir para o Plantão"}
      </button>
    </main>
  );
}
