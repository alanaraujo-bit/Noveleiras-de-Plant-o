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
  voltarPara = "/plantao",
  destaque,
}: {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  rodape?: ReactNode;
  voltarPara?: string;
  destaque?: { imagemUrl: string; etiqueta: string; titulo: string };
}) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-ink-950 lg:grid lg:grid-cols-[minmax(24rem,1.08fr)_minmax(25rem,0.92fr)]">
      <section className="relative h-[17rem] overflow-hidden lg:h-[100dvh]" aria-label="Sua história continua">
        <div
          aria-hidden
          className="absolute inset-0 scale-[1.03] bg-cover bg-center"
          style={{ backgroundImage: `url(${destaque?.imagemUrl ?? "/api/arte/hero/herdeira-do-silencio"})` }}
        />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(19_8_16/0.08),rgb(19_8_16/0.42)_62%,#130810)] lg:bg-[linear-gradient(90deg,rgb(19_8_16/0.08),rgb(19_8_16/0.2)_55%,#130810)]" />
      </section>

      <main
        className="relative z-10 -mt-9 flex min-h-[calc(100dvh-14.75rem)] flex-col rounded-t-[2rem] bg-ink-950 px-6 lg:mt-0 lg:min-h-[100dvh] lg:justify-center lg:rounded-none lg:px-10 xl:px-16"
        style={{ paddingBottom: "calc(var(--safe-b) + 1.5rem)" }}
      >
      <div className="flex items-center gap-2 pt-5 lg:absolute lg:left-10 lg:top-5 xl:left-16">
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
        <span className="font-display text-[0.875rem] font-semibold leading-tight text-cream-200">
          Noveleiras de Plantão
        </span>
      </div>

      <div className="mx-auto w-full max-w-[27rem]">
      <header className="mt-7 lg:mt-0">
        <h1 className="text-[2.25rem] leading-[1.04] text-balance-pt">{titulo}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-cream-200">
          {subtitulo}
        </p>
        {destaque ? (
          <p className="mt-4 border-l-2 border-gold-400/70 pl-3 text-[0.8125rem] leading-relaxed text-cream-400">
            <span className="font-semibold text-gold-300">{destaque.etiqueta}:</span>{" "}
            {destaque.titulo}
          </p>
        ) : null}
      </header>

      <div className="mt-6">{children}</div>

      {rodape ? <div className="mt-6">{rodape}</div> : null}
      </div>
      </main>
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

function IconeGoogle() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.4H3A10 10 0 0 0 2 12c0 1.7.4 3.2 1 4.6l3.4-2.7Z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7C7.2 7.7 9.4 5.9 12 5.9Z" />
    </svg>
  );
}

export function BotaoGoogle({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  const conteudo = (
    <>
      <IconeGoogle />
      {children}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="tap flex h-13 w-full items-center justify-center gap-3 rounded-2xl bg-cream-50 px-4 text-[0.9375rem] font-bold text-ink-950 shadow-[0_0.75rem_1.75rem_-0.85rem_rgb(0_0_0/0.75)] hover:bg-white"
    >
      {conteudo}
    </Link>
  ) : (
    <button
      type="button"
      disabled
      className="flex h-13 w-full items-center justify-center gap-3 rounded-2xl border border-white/12 bg-white/6 px-4 text-[0.9375rem] font-bold text-cream-400 opacity-75"
    >
      {conteudo}
    </button>
  );
}
