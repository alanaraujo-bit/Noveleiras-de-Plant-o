import Link from "next/link";
import type { ReactNode } from "react";

import { IconeVoltarPainel } from "@/components/painel/icones";

/**
 * Cabeçalho de página do painel.
 *
 * Fixo no topo ao rolar: numa tabela de mil linhas, saber onde se está e poder
 * trocar o período sem voltar ao começo é o que separa uma tela de trabalho de
 * um relatório impresso.
 */
export function Cabecalho({
  titulo,
  descricao,
  voltar,
  acoes,
  abas,
}: {
  titulo: string;
  descricao?: ReactNode;
  voltar?: { href: string; rotulo: string };
  acoes?: ReactNode;
  abas?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--p-linha)] bg-[color-mix(in_oklab,var(--p-fundo)_88%,transparent)] backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-3.5 pl-14 lg:px-6 lg:pl-6">
        <div className="min-w-0">
          {voltar ? (
            <Link
              href={voltar.href}
              className="mb-1 inline-flex items-center gap-1 text-[0.75rem] text-[var(--p-fraco)] transition-colors hover:text-[var(--p-suave)]"
            >
              <IconeVoltarPainel tamanho={13} />
              {voltar.rotulo}
            </Link>
          ) : null}
          <h1 className="titulo-editorial truncate text-[1.375rem] text-[var(--p-texto)]">
            {titulo}
          </h1>
          {descricao ? (
            <div className="mt-0.5 text-[0.8125rem] text-[var(--p-fraco)]">
              {descricao}
            </div>
          ) : null}
        </div>
        {acoes ? (
          <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-1">
            {acoes}
          </div>
        ) : null}
      </div>
      {abas ? <div className="px-4 lg:px-6">{abas}</div> : null}
    </header>
  );
}

/** Área de conteúdo da página. Mantém a mesma respiração em todas as telas. */
export function Conteudo({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`px-4 py-5 lg:px-6 lg:py-6 ${className}`}>{children}</main>
  );
}
