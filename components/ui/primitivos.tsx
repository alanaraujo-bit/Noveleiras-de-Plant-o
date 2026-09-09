import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Primitivos do sistema visual. Tudo que repete na interface nasce aqui. */

type BotaoVariante = "principal" | "secundario" | "fantasma" | "ouro";
type BotaoTamanho = "grande" | "medio" | "pequeno";

const VARIANTES: Record<BotaoVariante, string> = {
  principal:
    "bg-rose-600 text-cream-50 shadow-[0_0.5rem_1.5rem_-0.5rem_var(--color-rose-700)] hover:bg-rose-500",
  secundario:
    "bg-white/8 text-cream-50 border border-white/12 hover:bg-white/12",
  fantasma: "text-cream-200 hover:bg-white/8",
  ouro: "bg-gold-400 text-ink-950 font-bold hover:bg-gold-300",
};

const TAMANHOS: Record<BotaoTamanho, string> = {
  grande: "h-13 px-6 text-[0.9375rem] rounded-2xl",
  medio: "h-11 px-5 text-sm rounded-xl",
  pequeno: "h-9 px-3.5 text-[0.8125rem] rounded-lg",
};

const BASE =
  "tap inline-flex items-center justify-center gap-2 font-semibold tracking-tight transition-colors disabled:opacity-45 disabled:pointer-events-none";

export function Botao({
  variante = "principal",
  tamanho = "medio",
  largura,
  className = "",
  ...props
}: ComponentProps<"button"> & {
  variante?: BotaoVariante;
  tamanho?: BotaoTamanho;
  largura?: "cheia";
}) {
  return (
    <button
      {...props}
      className={`${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${
        largura === "cheia" ? "w-full" : ""
      } ${className}`}
    />
  );
}

export function BotaoLink({
  variante = "principal",
  tamanho = "medio",
  largura,
  className = "",
  ...props
}: ComponentProps<typeof Link> & {
  variante?: BotaoVariante;
  tamanho?: BotaoTamanho;
  largura?: "cheia";
}) {
  return (
    <Link
      {...props}
      className={`${BASE} ${VARIANTES[variante]} ${TAMANHOS[tamanho]} ${
        largura === "cheia" ? "w-full" : ""
      } ${className}`}
    />
  );
}

export function Selo({
  children,
  tom = "neutro",
  className = "",
}: {
  children: ReactNode;
  tom?: "neutro" | "ouro" | "carmim" | "jade";
  className?: string;
}) {
  const tons = {
    neutro: "bg-white/10 text-cream-200 border-white/10",
    ouro: "bg-gold-400/15 text-gold-300 border-gold-400/25",
    carmim: "bg-rose-600/20 text-rose-300 border-rose-500/30",
    jade: "bg-jade-400/15 text-jade-400 border-jade-400/25",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] ${tons[tom]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  ativo = false,
  className = "",
  ...props
}: ComponentProps<"button"> & { ativo?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      {...props}
      className={`tap shrink-0 rounded-full border px-3.5 py-2 text-[0.8125rem] font-semibold transition-colors ${
        ativo
          ? "border-transparent bg-cream-50 text-ink-950"
          : "border-white/12 bg-white/6 text-cream-200 hover:bg-white/10"
      } ${className}`}
    >
      {children}
    </button>
  );
}

const AVATAR_TONS = [
  "#c42a55",
  "#d9a355",
  "#8e6bc4",
  "#4f7cc4",
  "#5fc79b",
  "#e03a69",
  "#b3812f",
  "#a35bb0",
  "#3f8f7a",
];

export function Avatar({
  nome,
  seed = "1",
  fotoUrl,
  tamanho = 40,
  className = "",
}: {
  nome: string;
  seed?: string;
  fotoUrl?: string | null;
  tamanho?: number;
  className?: string;
}) {
  const index = (Number.parseInt(seed, 10) || 1) % AVATAR_TONS.length;
  const tone = AVATAR_TONS[index];
  const letra = nome.trim().charAt(0).toUpperCase() || "N";

  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-display font-semibold text-cream-50 ${className}`}
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: tamanho * 0.44,
        background: `linear-gradient(155deg, color-mix(in oklab, ${tone} 88%, white), color-mix(in oklab, ${tone} 72%, #130810))`,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.18)",
      }}
    >
      {fotoUrl ? (
        <img
          src={fotoUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        letra
      )}
    </span>
  );
}

export function BarraProgresso({
  percent,
  cor,
  className = "",
}: {
  percent: number;
  cor?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span
      className={`block h-[3px] w-full overflow-hidden rounded-full bg-white/15 ${className}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progresso do episódio"
    >
      <span
        className="block h-full rounded-full transition-[width] duration-500"
        style={{ width: `${clamped}%`, background: cor ?? "var(--color-rose-500)" }}
      />
    </span>
  );
}

export function TituloSecao({
  children,
  sobretitulo,
  acao,
}: {
  children: ReactNode;
  sobretitulo?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-end justify-between gap-3 px-5">
      <div className="min-w-0">
        {sobretitulo ? <p className="eyebrow mb-1">{sobretitulo}</p> : null}
        <h2 className="truncate text-[1.3125rem] leading-tight">{children}</h2>
      </div>
      {acao ? <div className="shrink-0 pb-0.5">{acao}</div> : null}
    </div>
  );
}

export function EstadoVazio({
  titulo,
  descricao,
  icone,
  acao,
}: {
  titulo: string;
  descricao: string;
  icone?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="mx-5 flex flex-col items-center rounded-panel border border-white/8 bg-white/[0.025] px-6 py-11 text-center">
      {icone ? (
        <div
          className="mb-4 grid size-14 place-items-center rounded-2xl text-gold-400"
          style={{
            background:
              "radial-gradient(120% 120% at 30% 20%, rgb(233 189 120 / 0.18), rgb(255 255 255 / 0.03))",
          }}
        >
          {icone}
        </div>
      ) : null}
      <h3 className="text-lg">{titulo}</h3>
      <p className="selectable mt-1.5 max-w-[22rem] text-sm leading-relaxed text-cream-400">
        {descricao}
      </p>
      {acao ? <div className="mt-5">{acao}</div> : null}
    </div>
  );
}

export function Esqueleto({ className = "" }: { className?: string }) {
  return <span className={`skeleton block rounded-xl ${className}`} />;
}

/** Divisória com um pontilhado de folhetim, para separar blocos editoriais. */
export function Divisoria({ className = "" }: { className?: string }) {
  return (
    <div
      className={`mx-5 my-7 flex items-center gap-3 text-gold-400/40 ${className}`}
      aria-hidden
    >
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/12" />
      <span className="text-[0.625rem] tracking-[0.3em]">◆</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/12" />
    </div>
  );
}
