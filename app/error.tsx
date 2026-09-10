"use client";

import { useEffect } from "react";

export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[plantão] erro de renderização", error);
  }, [error]);

  return (
    <div
      className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center px-8 text-center"
      style={{ paddingBottom: "calc(var(--safe-b) + 2rem)" }}
    >
      <p className="eyebrow">Deu ruim aqui do nosso lado</p>
      <h1 className="mt-2.5 text-[2rem] leading-tight text-balance-pt">
        Não conseguimos montar esta tela
      </h1>
      <p className="mt-3 max-w-[22rem] text-[0.9375rem] leading-relaxed text-cream-400">
        Foi um problema nosso, não seu. Tente de novo — costuma passar na
        segunda tentativa.
      </p>
      <div className="mt-7 flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="tap flex h-13 items-center justify-center rounded-2xl bg-rose-600 text-[0.9375rem] font-bold text-cream-50"
        >
          Tentar de novo
        </button>
        <a
          href="/plantao"
          className="tap flex h-13 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-[0.9375rem] font-semibold text-cream-200"
        >
          Voltar ao início
        </a>
      </div>
      {error.digest ? (
        <p className="mt-5 text-[0.6875rem] text-cream-600">
          Código do erro: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
