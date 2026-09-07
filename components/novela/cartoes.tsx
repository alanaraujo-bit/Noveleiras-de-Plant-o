import Link from "next/link";

import { BarraProgresso, Selo } from "@/components/ui/primitivos";
import { IconeCadeado, IconePlay } from "@/components/ui/icones";
import { episodeLabel, formatClock, formatRating } from "@/lib/format";
import type { NovelaCard } from "@/lib/repositories/catalog";
import type { ContinueItem } from "@/lib/repositories/progresso";

/**
 * Capa de novela.
 *
 * A arte é abstrata e o título vem em HTML por cima — nítido em qualquer tela,
 * legível para leitores de tela e pronto para receber arte fotográfica real sem
 * mudar o componente.
 */
export function Capa({
  novela,
  largura = "media",
  prioridade = false,
}: {
  novela: NovelaCard;
  largura?: "media" | "larga" | "cheia";
  prioridade?: boolean;
}) {
  const tamanhos = {
    media: "w-[8.75rem]",
    larga: "w-[11.5rem]",
    cheia: "w-full",
  } as const;

  return (
    <Link
      href={`/novela/${novela.slug}`}
      className={`tap group block ${tamanhos[largura]}`}
    >
      <div
        className="relative overflow-hidden rounded-card border border-white/8 shadow-poster"
        style={{ aspectRatio: "2 / 3" }}
      >
        <img
          src={novela.posterUrl}
          alt=""
          loading={prioridade ? "eager" : "lazy"}
          fetchPriority={prioridade ? "high" : "auto"}
          className="absolute inset-0 size-full object-cover"
        />

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <span
            className="mb-1.5 block h-px w-7 rounded-full"
            style={{ background: "var(--color-gold-400)" }}
          />
          <h3 className="line-clamp-2 font-display text-[0.9375rem] font-semibold leading-[1.15] text-cream-50 drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]">
            {novela.title}
          </h3>
        </div>

        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-1">
          {novela.isNew && novela.status !== "COMING_SOON" ? (
            <Selo tom="carmim">Novo</Selo>
          ) : novela.status === "COMING_SOON" ? (
            <Selo tom="ouro">Em breve</Selo>
          ) : (
            <span />
          )}
          {novela.accessTier === "PREMIUM" ? (
            <span
              className="grid size-6 place-items-center rounded-full bg-ink-950/70 text-gold-400 backdrop-blur-sm"
              title="Conteúdo do plano Premium"
            >
              <IconeCadeado tamanho={13} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 px-0.5 text-[0.6875rem] font-medium text-cream-600">
        {novela.rating > 0 ? (
          <>
            <span className="text-gold-400">★</span>
            <span>{formatRating(novela.rating)}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span className="truncate">
          {novela.episodeCount} {novela.episodeCount === 1 ? "ep." : "eps."}
        </span>
      </div>
    </Link>
  );
}

export function TrilhoCapas({
  novelas,
  largura = "media",
  prioridade = false,
}: {
  novelas: NovelaCard[];
  largura?: "media" | "larga";
  prioridade?: boolean;
}) {
  return (
    <div className="rail no-scrollbar pb-1">
      {novelas.map((novela, index) => (
        <div key={novela.id} className="rail-item">
          <Capa
            novela={novela}
            largura={largura}
            prioridade={prioridade && index < 3}
          />
        </div>
      ))}
      <span className="w-1 shrink-0" aria-hidden />
    </div>
  );
}

/** Cartão de "continuar assistindo": miniatura larga, progresso e retomada. */
export function CartaoContinuar({ item }: { item: ContinueItem }) {
  const restante = Math.max(0, item.durationSec - item.positionSec);

  return (
    <Link
      href={`/assistir/${item.episodeId}`}
      className="tap block w-[16.5rem] shrink-0"
    >
      <div
        className="relative overflow-hidden rounded-card border border-white/8 shadow-poster"
        style={{ aspectRatio: "16 / 9" }}
      >
        <img
          src={item.thumbUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/10 to-transparent" />

        <span
          className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-cream-50 backdrop-blur-sm"
          style={{ background: "rgb(19 8 16 / 0.55)", boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.18)" }}
        >
          <IconePlay tamanho={17} />
        </span>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-gold-400">
            {episodeLabel(item.seasonNumber, item.episodeNumber)}
          </p>
          <p className="line-clamp-1 font-display text-[0.9375rem] font-semibold text-cream-50">
            {item.title}
          </p>
          <div className="mt-2">
            <BarraProgresso percent={item.percent} cor={item.accent} />
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-1 px-0.5 text-[0.75rem] text-cream-400">
        {item.percent > 0
          ? `Faltam ${formatClock(restante)} · ${item.episodeTitle}`
          : `Começa agora · ${item.episodeTitle}`}
      </p>
    </Link>
  );
}

export function TrilhoContinuar({ itens }: { itens: ContinueItem[] }) {
  return (
    <div className="rail no-scrollbar pb-1">
      {itens.map((item) => (
        <div key={item.episodeId} className="rail-item">
          <CartaoContinuar item={item} />
        </div>
      ))}
      <span className="w-1 shrink-0" aria-hidden />
    </div>
  );
}

/** Linha de novela em listas verticais (busca, gênero, minha lista). */
export function LinhaNovela({
  novela,
  legenda,
}: {
  novela: NovelaCard;
  legenda?: string;
}) {
  return (
    <Link
      href={`/novela/${novela.slug}`}
      className="tap flex items-center gap-3.5 px-5 py-2.5"
    >
      <div
        className="relative w-[4.25rem] shrink-0 overflow-hidden rounded-xl border border-white/8"
        style={{ aspectRatio: "2 / 3" }}
      >
        <img
          src={novela.posterUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[1.0625rem] leading-snug">{novela.title}</h3>
        <p className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-cream-400">
          {legenda ?? novela.tagline}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-medium text-cream-600">
          <span>{novela.year}</span>
          <span aria-hidden>·</span>
          <span>{novela.episodeCount} eps.</span>
          {novela.genres[0] ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{novela.genres[0].name}</span>
            </>
          ) : null}
          {novela.accessTier === "PREMIUM" ? (
            <Selo tom="ouro" className="ml-0.5">
              Premium
            </Selo>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
