"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { IconeBuscaPainel, IconeFecharPainel } from "@/components/painel/icones";

/**
 * Filtros de tabela.
 *
 * Tudo vive na URL. Num painel isso não é detalhe de implementação: é o que
 * permite mandar "olha esses usuários" para outra pessoa, voltar no navegador
 * sem perder o recorte e recarregar a página no meio de uma investigação sem
 * começar de novo.
 */

function useParametro() {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();
  const [pendente, iniciar] = useTransition();

  const definir = (mudancas: Record<string, string | null>) => {
    const novos = new URLSearchParams(parametros.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") novos.delete(chave);
      else novos.set(chave, valor);
    }
    // Qualquer mudança de filtro invalida a página em que se estava.
    if (!("pagina" in mudancas)) novos.delete("pagina");
    iniciar(() =>
      router.push(`${pathname}?${novos.toString()}`, { scroll: false }),
    );
  };

  return { parametros, definir, pendente };
}

/** Campo de busca com espera: uma consulta por pausa de digitação, não por tecla. */
export function CampoDeBusca({
  chave = "q",
  placeholder = "Buscar…",
  largura = "18rem",
}: {
  chave?: string;
  placeholder?: string;
  largura?: string;
}) {
  const { parametros, definir, pendente } = useParametro();
  const inicial = parametros.get(chave) ?? "";
  const [valor, setValor] = useState(inicial);
  const primeiro = useRef(true);

  // Ressincroniza quando a URL muda por fora (voltar no navegador, limpar).
  useEffect(() => {
    setValor(inicial);
  }, [inicial]);

  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    if (valor === inicial) return;
    const timer = window.setTimeout(() => definir({ [chave]: valor }), 350);
    return () => window.clearTimeout(timer);
    // `definir` muda a cada render; incluí-lo reiniciaria a espera para sempre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  return (
    <div className="relative" style={{ width: largura, maxWidth: "100%" }}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--p-fraco)]">
        <IconeBuscaPainel tamanho={15} />
      </span>
      <input
        type="search"
        value={valor}
        onChange={(evento) => setValor(evento.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] pr-8 pl-8 text-[0.8125rem] text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none"
      />
      {valor ? (
        <button
          type="button"
          onClick={() => {
            setValor("");
            definir({ [chave]: null });
          }}
          aria-label="Limpar busca"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-[var(--p-fraco)] hover:text-[var(--p-texto)]"
        >
          <IconeFecharPainel tamanho={13} />
        </button>
      ) : null}
      {pendente ? (
        <span className="absolute -bottom-px left-0 h-px w-full overflow-hidden">
          <span className="block h-full w-1/3 animate-[shimmer_1.2s_infinite] bg-[var(--p-acento)]" />
        </span>
      ) : null}
    </div>
  );
}

export function Seletor({
  chave,
  rotulo,
  opcoes,
  padrao = "",
}: {
  chave: string;
  rotulo: string;
  opcoes: { valor: string; rotulo: string }[];
  padrao?: string;
}) {
  const { parametros, definir } = useParametro();
  const atual = parametros.get(chave) ?? padrao;

  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{rotulo}</span>
      <select
        value={atual}
        onChange={(evento) => definir({ [chave]: evento.target.value || null })}
        aria-label={rotulo}
        className="h-8 rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)] focus:border-[var(--p-acento)] focus:outline-none"
      >
        {opcoes.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Interruptor simples ligado à URL (por exemplo: incluir contas de demonstração). */
export function Alternador({
  chave,
  rotulo,
}: {
  chave: string;
  rotulo: string;
}) {
  const { parametros, definir } = useParametro();
  const ligado = parametros.get(chave) === "1";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => definir({ [chave]: ligado ? null : "1" })}
      className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[0.8125rem] transition-colors ${
        ligado
          ? "border-[var(--color-rose-500)]/30 bg-[var(--p-acento-suave)] text-[var(--p-texto)]"
          : "border-[var(--p-linha)] bg-[var(--p-superficie)] text-[var(--p-fraco)] hover:text-[var(--p-suave)]"
      }`}
    >
      <span
        aria-hidden
        className={`h-3.5 w-6 rounded-full p-0.5 transition-colors ${
          ligado ? "bg-[var(--color-rose-600)]" : "bg-white/12"
        }`}
      >
        <span
          className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
            ligado ? "translate-x-2.5" : ""
          }`}
        />
      </span>
      {rotulo}
    </button>
  );
}

export function Paginacao({
  pagina,
  paginas,
  total,
  rotuloItem = "resultados",
}: {
  pagina: number;
  paginas: number;
  total: number;
  rotuloItem?: string;
}) {
  const { definir, pendente } = useParametro();
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--p-linha)] px-4 py-3">
      <p className="tabular text-[0.75rem] text-[var(--p-fraco)]">
        {new Intl.NumberFormat("pt-BR").format(total)} {rotuloItem}
        {paginas > 1 ? ` · página ${pagina} de ${paginas}` : ""}
      </p>
      {paginas > 1 ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={pagina <= 1 || pendente}
            onClick={() => definir({ pagina: String(pagina - 1) })}
            className="h-7 rounded-md border border-[var(--p-linha)] px-2.5 text-[0.75rem] text-[var(--p-suave)] transition-colors hover:bg-white/6 disabled:pointer-events-none disabled:opacity-35"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={pagina >= paginas || pendente}
            onClick={() => definir({ pagina: String(pagina + 1) })}
            className="h-7 rounded-md border border-[var(--p-linha)] px-2.5 text-[0.75rem] text-[var(--p-suave)] transition-colors hover:bg-white/6 disabled:pointer-events-none disabled:opacity-35"
          >
            Próxima
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Linha de filtros: uma faixa só acima da tabela, nunca uma coluna lateral. */
export function BarraDeFiltros({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--p-linha)] px-4 py-3">
      {children}
    </div>
  );
}
