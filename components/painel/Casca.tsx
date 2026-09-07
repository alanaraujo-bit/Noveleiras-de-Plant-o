"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { GrupoDeNavegacao } from "@/lib/painel/navegacao";
import {
  IconeAdmin,
  IconeAlertas,
  IconeAuditoria,
  IconeBuscaPainel,
  IconeCatalogo,
  IconeComunidade,
  IconeFecharPainel,
  IconeFinanceiro,
  IconeLogs,
  IconeMenu,
  IconeMidia,
  IconePainel,
  IconeSaida,
  IconeServidor,
  IconeStreaming,
  IconeTranscode,
  IconeUsuarios,
} from "@/components/painel/icones";

/**
 * Casca do painel.
 *
 * Barra lateral fixa no desktop — onde a operação acontece — e gaveta no
 * celular. A navegação é sempre a mesma lista; o que muda é como ela se
 * apresenta, não o que ela contém.
 */

const ICONES = {
  painel: IconePainel,
  alertas: IconeAlertas,
  usuarios: IconeUsuarios,
  streaming: IconeStreaming,
  busca: IconeBuscaPainel,
  catalogo: IconeCatalogo,
  midia: IconeMidia,
  comunidade: IconeComunidade,
  servidor: IconeServidor,
  transcode: IconeTranscode,
  financeiro: IconeFinanceiro,
  logs: IconeLogs,
  auditoria: IconeAuditoria,
  admin: IconeAdmin,
} as const;

function ehAtual(pathname: string, href: string): boolean {
  // "/painel" só é atual na própria raiz; os demais valem para as subrotas,
  // senão a ficha de um usuário deixaria "Usuários" apagado no menu.
  if (href === "/painel") return pathname === "/painel";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Casca({
  grupos,
  operador,
  alertasAbertos,
  children,
}: {
  grupos: GrupoDeNavegacao[];
  operador: { nome: string; email: string; papel: string };
  alertasAbertos: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [gavetaAberta, setGavetaAberta] = useState(false);

  // Navegar fecha a gaveta: deixá-la aberta sobre a tela nova é um bug clássico.
  useEffect(() => {
    setGavetaAberta(false);
  }, [pathname]);

  useEffect(() => {
    if (!gavetaAberta) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setGavetaAberta(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [gavetaAberta]);

  const navegacao = (
    <nav className="flex-1 overflow-y-auto px-3 py-4">
      {grupos.map((grupo) => (
        <div key={grupo.titulo} className="mb-5 last:mb-0">
          <p className="mb-1.5 px-2.5 text-[0.625rem] font-semibold tracking-[0.08em] text-[var(--p-fraco)] uppercase">
            {grupo.titulo}
          </p>
          <ul className="space-y-0.5">
            {grupo.itens.map((item) => {
              const Icone = ICONES[item.icone];
              const atual = ehAtual(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={atual ? "page" : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] transition-colors ${
                      atual
                        ? "bg-[var(--p-acento-suave)] font-medium text-[var(--p-texto)]"
                        : "text-[var(--p-suave)] hover:bg-white/5 hover:text-[var(--p-texto)]"
                    }`}
                  >
                    {/* Marca de página atual: fina, à esquerda, na cor do acento. */}
                    <span
                      aria-hidden
                      className={`absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-r-full bg-[var(--p-acento)] transition-opacity ${
                        atual ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <Icone
                      tamanho={17}
                      className={
                        atual
                          ? "text-[var(--color-rose-400)]"
                          : "text-[var(--p-fraco)] group-hover:text-[var(--p-suave)]"
                      }
                    />
                    <span className="flex-1 truncate">{item.rotulo}</span>
                    {item.href === "/painel/alertas" && alertasAbertos > 0 ? (
                      <span className="tabular rounded-full bg-[var(--p-perigo)]/18 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--p-perigo)]">
                        {alertasAbertos}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const rodape = (
    <div className="border-t border-[var(--p-linha)] p-3">
      <div className="mb-2 px-1.5">
        <p className="truncate text-[0.8125rem] font-medium text-[var(--p-texto)]">
          {operador.nome}
        </p>
        <p className="truncate text-[0.6875rem] text-[var(--p-fraco)]">
          {operador.papel}
        </p>
      </div>
      <div className="flex gap-1.5">
        <Link
          href="/inicio"
          className="flex-1 rounded-lg px-2.5 py-1.5 text-center text-[0.75rem] text-[var(--p-suave)] transition-colors hover:bg-white/6 hover:text-[var(--p-texto)]"
        >
          Ver o app
        </Link>
        <form action="/painel/sair" method="post">
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.75rem] text-[var(--p-suave)] transition-colors hover:bg-white/6 hover:text-[var(--p-texto)]"
          >
            <IconeSaida tamanho={14} />
            Sair
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div
      data-superficie="painel"
      className="min-h-dvh"
      style={{ minHeight: "100dvh" }}
    >
      {/* ------------------------------------------------ lateral no desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--p-lateral-l)] flex-col border-r border-[var(--p-linha)] bg-[var(--p-lateral)] lg:flex">
        <Link
          href="/painel"
          className="flex items-center gap-2.5 border-b border-[var(--p-linha)] px-4 py-3.5"
        >
          <MarcaPainel />
        </Link>
        {navegacao}
        {rodape}
      </aside>

      {/* --------------------------------------------------- gaveta no toque */}
      {gavetaAberta ? (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setGavetaAberta(false)}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-[var(--p-linha)] bg-[var(--p-lateral)] lg:hidden">
            <div className="flex items-center justify-between border-b border-[var(--p-linha)] px-4 py-3.5">
              <MarcaPainel />
              <button
                type="button"
                onClick={() => setGavetaAberta(false)}
                aria-label="Fechar menu"
                className="rounded-lg p-1.5 text-[var(--p-suave)] hover:bg-white/6"
              >
                <IconeFecharPainel tamanho={18} />
              </button>
            </div>
            {navegacao}
            {rodape}
          </aside>
        </>
      ) : null}

      {/* ------------------------------------------------------------ conteúdo */}
      <div className="lg:pl-[var(--p-lateral-l)]">
        <button
          type="button"
          onClick={() => setGavetaAberta(true)}
          className="fixed top-3 left-3 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--p-linha-forte)] bg-[var(--p-elevado)] text-[var(--p-suave)] lg:hidden"
          aria-label="Abrir menu"
        >
          <IconeMenu tamanho={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

function MarcaPainel() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-rose-600)] text-[0.8125rem] font-bold text-white"
      >
        N
      </span>
      <span className="leading-tight">
        <span className="block text-[0.8125rem] font-semibold text-[var(--p-texto)]">
          Noveleiras
        </span>
        <span className="block text-[0.625rem] text-[var(--p-fraco)]">
          Central de operações
        </span>
      </span>
    </span>
  );
}
