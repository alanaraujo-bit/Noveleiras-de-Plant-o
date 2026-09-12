"use client";

import Link from "next/link";

/**
 * Falha ao montar a fila do reel.
 *
 * Esta fronteira existe por um motivo específico: `/plantao` é a primeira tela
 * depois de entrar, e o `app/error.tsx` da raiz oferece "Voltar ao início" —
 * que agora aponta para `/plantao`. Sem este arquivo, uma falha aqui deixaria a
 * pessoa presa num laço, tentando voltar exatamente para a rota que quebrou.
 *
 * As duas saídas são deliberadamente diferentes entre si: uma repete a
 * operação que falhou, a outra leva a um caminho que não depende dela.
 */
export default function ErroDoPlantao({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center"
      style={{ paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 2rem)" }}
    >
      <p className="eyebrow">Plantão</p>
      <h1 className="mt-2 text-[1.5rem] leading-tight text-balance-pt">
        Não deu para montar sua fila
      </h1>
      <p className="mt-2.5 max-w-[22rem] text-[0.9375rem] leading-relaxed text-cream-400">
        Foi uma falha nossa ao preparar os episódios, não algo com a sua conta.
        Seu progresso e sua lista estão intactos.
      </p>

      <div className="mt-7 flex w-full max-w-[18rem] flex-col gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="tap flex h-13 items-center justify-center rounded-2xl bg-rose-600 text-[0.9375rem] font-bold text-cream-50"
        >
          Tentar de novo
        </button>
        <Link
          href="/explorar"
          className="tap flex h-13 items-center justify-center rounded-2xl border border-white/12 bg-white/6 text-[0.9375rem] font-semibold text-cream-200"
        >
          Ir para o catálogo
        </Link>
      </div>

      {/* O código é o que liga esta tela à linha de log do servidor. */}
      {error.digest ? (
        <p className="selectable mt-5 text-[0.6875rem] text-cream-600">
          Código da falha: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
