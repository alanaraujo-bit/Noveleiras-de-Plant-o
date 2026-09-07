"use client";

import Link from "next/link";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

import { IconeMarca, IconeOlho, IconeVoltar } from "@/components/ui/icones";

/** Moldura das telas de conta: marca, título e espaço para o formulário. */
export function MolduraConta({
  titulo,
  subtitulo,
  children,
  rodape,
  voltarPara = "/bem-vindo",
}: {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  rodape?: ReactNode;
  voltarPara?: string;
}) {
  return (
    <div
      className="relative mx-auto flex min-h-[100dvh] max-w-lg flex-col px-6"
      style={{
        paddingTop: "calc(var(--safe-t) + 1.25rem)",
        paddingBottom: "calc(var(--safe-b) + 1.5rem)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64"
        style={{
          background:
            "radial-gradient(110% 100% at 20% 0%, rgb(196 42 85 / 0.32), transparent 70%)",
        }}
      />

      <div className="relative flex items-center gap-2">
        <Link
          href={voltarPara}
          aria-label="Voltar"
          className="tap -ml-2 grid size-10 place-items-center rounded-full text-cream-200 hover:bg-white/8"
        >
          <IconeVoltar tamanho={21} />
        </Link>
        <span className="text-rose-500">
          <IconeMarca tamanho={24} />
        </span>
        <span className="font-display text-[0.875rem] font-semibold text-cream-200">
          Noveleiras de Plantão
        </span>
      </div>

      <header className="relative mt-9">
        <h1 className="text-[2rem] leading-[1.08] text-balance-pt">{titulo}</h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-cream-400">
          {subtitulo}
        </p>
      </header>

      <div className="relative mt-7 flex-1">{children}</div>

      {rodape ? <div className="relative mt-6">{rodape}</div> : null}
    </div>
  );
}

export function Campo({
  rotulo,
  erro,
  dica,
  className = "",
  ...props
}: ComponentProps<"input"> & {
  rotulo: string;
  erro?: string | null;
  dica?: string;
}) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);
  const isSenha = props.type === "password";
  const descricaoId = dica || erro ? `${id}-desc` : undefined;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[0.8125rem] font-semibold text-cream-200"
      >
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={id}
          {...props}
          type={isSenha && visivel ? "text" : props.type}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descricaoId}
          className={`h-13 w-full rounded-2xl border bg-white/[0.04] px-4 text-[1rem] text-cream-50 outline-none transition-colors placeholder:text-cream-600 focus:border-rose-500/70 focus:bg-white/[0.06] ${
            isSenha ? "pr-13" : ""
          } ${erro ? "border-rose-500/70" : "border-white/12"}`}
        />
        {isSenha ? (
          <button
            type="button"
            onClick={() => setVisivel((v) => !v)}
            aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
            className="tap absolute right-1.5 top-1.5 grid size-10 place-items-center rounded-xl text-cream-400 hover:bg-white/8"
          >
            <IconeOlho tamanho={19} fechado={visivel} />
          </button>
        ) : null}
      </div>
      {erro ? (
        <p id={descricaoId} role="alert" className="mt-1.5 text-[0.8125rem] text-rose-300">
          {erro}
        </p>
      ) : dica ? (
        <p id={descricaoId} className="mt-1.5 text-[0.75rem] text-cream-600">
          {dica}
        </p>
      ) : null}
    </div>
  );
}

export function BotaoEnviar({
  children,
  pendente,
  pendenteTexto,
}: {
  children: ReactNode;
  pendente: boolean;
  pendenteTexto: string;
}) {
  return (
    <button
      type="submit"
      disabled={pendente}
      className="tap flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 text-[0.9375rem] font-bold tracking-tight text-cream-50 shadow-[0_0.5rem_1.75rem_-0.5rem_var(--color-rose-700)] disabled:opacity-60"
    >
      {pendente ? (
        <>
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-cream-50/40 border-t-cream-50"
          />
          {pendenteTexto}
        </>
      ) : (
        children
      )}
    </button>
  );
}
