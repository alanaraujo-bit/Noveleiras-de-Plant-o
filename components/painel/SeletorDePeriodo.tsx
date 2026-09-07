"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { IconeCalendario } from "@/components/painel/icones";
import { PERIODOS } from "@/lib/painel/tempo";

/**
 * Escolha da janela de tempo.
 *
 * Fica na URL, não em estado local: um recorte interessante precisa ser
 * compartilhável ("olha o pico de terça"), e voltar no navegador precisa
 * voltar para o recorte anterior, não para o padrão.
 */

const ATALHOS = Object.entries(PERIODOS) as [keyof typeof PERIODOS, string][];

export function SeletorDePeriodo() {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const [abertoPersonalizado, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const atual = parametros.get("periodo") ?? "30d";
  const de = parametros.get("de") ?? "";
  const ate = parametros.get("ate") ?? "";

  useEffect(() => {
    if (!abertoPersonalizado) return;
    const aoClicar = (evento: MouseEvent) => {
      if (!caixa.current?.contains(evento.target as Node)) setAberto(false);
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [abertoPersonalizado]);

  function trocar(chave: string, extras?: { de?: string; ate?: string }) {
    const novos = new URLSearchParams(parametros.toString());
    novos.set("periodo", chave);
    if (extras?.de) novos.set("de", extras.de);
    else if (chave !== "personalizado") novos.delete("de");
    if (extras?.ate) novos.set("ate", extras.ate);
    else if (chave !== "personalizado") novos.delete("ate");
    // Trocar o período reinicia a paginação: continuar na página 7 de outro
    // recorte mostraria uma tela vazia sem explicação.
    novos.delete("pagina");
    iniciar(() => router.push(`${pathname}?${novos.toString()}`, { scroll: false }));
  }

  return (
    <div
      ref={caixa}
      aria-busy={pendente}
      className={`relative flex w-max items-center gap-1 rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] p-0.5 transition-opacity ${
        pendente ? "cursor-wait opacity-60" : ""
      }`}
      data-pendente={pendente ? "" : undefined}
    >
      {ATALHOS.map(([chave, rotulo]) => (
        <button
          key={chave}
          type="button"
          onClick={() => trocar(chave)}
          disabled={pendente}
          aria-pressed={atual === chave}
          className={`rounded-md px-2.5 py-1 text-[0.75rem] font-medium whitespace-nowrap transition-colors ${
            atual === chave
              ? "bg-[var(--p-acento-suave)] text-[var(--p-texto)]"
              : "text-[var(--p-fraco)] hover:bg-white/5 hover:text-[var(--p-suave)]"
          }`}
        >
          {rotulo}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={pendente}
        aria-expanded={abertoPersonalizado}
        aria-label="Período personalizado"
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium transition-colors ${
          atual === "personalizado"
            ? "bg-[var(--p-acento-suave)] text-[var(--p-texto)]"
            : "text-[var(--p-fraco)] hover:bg-white/5 hover:text-[var(--p-suave)]"
        }`}
      >
        <IconeCalendario tamanho={14} />
        {atual === "personalizado" && de ? (
          <span className="tabular hidden sm:inline">
            {de.slice(8)}/{de.slice(5, 7)} – {ate.slice(8)}/{ate.slice(5, 7)}
          </span>
        ) : null}
      </button>

      <span className="sr-only" aria-live="polite">
        {pendente ? "Atualizando o período" : ""}
      </span>

      {pendente ? (
        <span
          aria-hidden
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--p-alto)_92%,transparent)] text-[0.75rem] font-medium text-[var(--p-texto)]"
        >
          Atualizando…
        </span>
      ) : null}

      {abertoPersonalizado ? (
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            const dados = new FormData(evento.currentTarget);
            const inicio = String(dados.get("de") ?? "");
            const fim = String(dados.get("ate") ?? "");
            if (!inicio || !fim) return;
            setAberto(false);
            trocar("personalizado", { de: inicio, ate: fim });
          }}
          className="absolute top-full right-0 z-30 mt-2 w-64 rounded-xl border border-[var(--p-linha-forte)] bg-[var(--p-alto)] p-3 shadow-[0_1rem_2rem_-0.75rem_rgb(0_0_0/0.7)]"
        >
          <p className="mb-2 text-[0.75rem] font-medium text-[var(--p-texto)]">
            Escolher um intervalo
          </p>
          <label className="mb-2 block">
            <span className="mb-1 block text-[0.6875rem] text-[var(--p-fraco)]">
              De
            </span>
            <input
              type="date"
              name="de"
              defaultValue={de}
              required
              className="w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 py-1.5 text-[0.8125rem] text-[var(--p-texto)]"
            />
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-[0.6875rem] text-[var(--p-fraco)]">
              Até
            </span>
            <input
              type="date"
              name="ate"
              defaultValue={ate}
              required
              className="w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 py-1.5 text-[0.8125rem] text-[var(--p-texto)]"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--color-rose-600)] px-3 py-1.5 text-[0.8125rem] font-medium text-white hover:bg-[var(--color-rose-500)]"
          >
            Aplicar
          </button>
        </form>
      ) : null}
    </div>
  );
}
