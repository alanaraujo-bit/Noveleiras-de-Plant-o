"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { alternarFavorito, registrarAcessoNovela } from "@/lib/actions/catalogo";
import { useToast } from "@/components/sistema/ToastProvider";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { BarraProgresso, Selo } from "@/components/ui/primitivos";
import { PlayerTrailer } from "@/components/novela/PlayerTrailer";
import {
  IconeCadeado,
  IconeCheck,
  IconeCompartilhar,
  IconeCoracao,
  IconePlay,
  IconeVoltar,
} from "@/components/ui/icones";
import { STATUS_LABEL, formatClock, formatCount, formatRating } from "@/lib/format";
import type { NovelaDetail } from "@/lib/repositories/catalog";

/**
 * Página da novela: capa, ficha, temporadas e episódios.
 * Cliente porque concentra as interações — lista, temporada, sinopse.
 */
export function PainelNovela({
  novela,
  esconderSpoiler,
}: {
  novela: NovelaDetail;
  esconderSpoiler: boolean;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [favorito, setFavorito] = useState(novela.isFavorite);
  const [temporada, setTemporada] = useState(
    novela.resume?.seasonNumber ?? novela.seasons[0]?.number ?? 1,
  );
  const [sinopseAberta, setSinopseAberta] = useState(false);
  // O trailer abre sobre a página, e não na rota `/assistir`: aquela rota é a
  // que registra progresso de episódio, e trailer não é episódio.
  const [trailerAberto, setTrailerAberto] = useState(false);
  const [salvando, iniciar] = useTransition();

  useEffect(() => {
    track("NOVELA_VIEW", { novelaId: novela.id, entityId: novela.slug });
    void registrarAcessoNovela(novela.id);
  }, [novela.id, novela.slug, track]);

  const temporadaAtual =
    novela.seasons.find((item) => item.number === temporada) ?? novela.seasons[0];

  const marcarLista = () => {
    iniciar(async () => {
      const resultado = await alternarFavorito(novela.id, novela.slug);
      if (!resultado.ok) {
        show("Entre na sua conta para usar a lista.", "ruim");
        return;
      }
      setFavorito(resultado.favorito);
      show(
        resultado.favorito
          ? "Adicionada à sua lista"
          : "Removida da sua lista",
        resultado.favorito ? "bom" : "neutro",
      );
    });
  };

  const compartilhar = async () => {
    const url = `${window.location.origin}/novela/${novela.slug}`;
    if (navigator.share) {
      await navigator
        .share({ title: novela.title, text: novela.tagline, url })
        .catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url).then(
      () => show("Link copiado", "bom"),
      () => show("Não consegui copiar o link", "ruim"),
    );
  };

  return (
    <article>
      {/* Capa ------------------------------------------------------------ */}
      <div className="relative">
        {/* 3:4 em vez de um cartaz inteiro: sobra menos vazio acima do título
            e o primeiro episódio já aparece com uma rolagem curta. */}
        <div className="relative" style={{ aspectRatio: "3 / 4" }}>
          <img
            src={novela.heroUrl}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-ink-950/45" />
        </div>

        <div
          className="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3"
          style={{ paddingTop: "calc(var(--safe-t) + 0.75rem)" }}
        >
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Voltar"
            className="tap grid size-10 place-items-center rounded-full bg-ink-950/55 text-cream-50 backdrop-blur-sm"
          >
            <IconeVoltar tamanho={20} />
          </button>
          <button
            type="button"
            onClick={compartilhar}
            aria-label={`Compartilhar ${novela.title}`}
            className="tap grid size-10 place-items-center rounded-full bg-ink-950/55 text-cream-50 backdrop-blur-sm"
          >
            <IconeCompartilhar tamanho={19} />
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-5 pb-1">
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <Selo tom={novela.status === "COMPLETED" ? "jade" : "ouro"}>
              {STATUS_LABEL[novela.status]}
            </Selo>
            {novela.openAccess ? (
              <Selo tom="jade">Grátis por inteiro</Selo>
            ) : null}
          </div>
          <h1 className="text-[2.125rem] leading-[1.04] text-balance-pt">
            {novela.title}
          </h1>
          <p className="selectable mt-2 text-[0.9375rem] leading-relaxed text-cream-200">
            {novela.tagline}
          </p>
        </div>
      </div>

      {/* Ficha ----------------------------------------------------------- */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-5 text-[0.8125rem] text-cream-400">
        {novela.rating > 0 ? (
          <span className="font-semibold text-gold-400">
            ★ {formatRating(novela.rating)}
            <span className="ml-1 font-normal text-cream-600">
              ({formatCount(novela.ratingCount)})
            </span>
          </span>
        ) : null}
        <span>{novela.year}</span>
        <span aria-hidden>·</span>
        <span>{novela.totalEpisodes} episódios</span>
        <span aria-hidden>·</span>
        <span className="rounded border border-white/20 px-1 text-[0.75rem]">
          {novela.ageRating}
        </span>
        {novela.favoriteCount > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span>{formatCount(novela.favoriteCount)} na lista</span>
          </>
        ) : null}
      </div>

      {/* Ações ----------------------------------------------------------- */}
      <div className="mt-4 flex items-center gap-2.5 px-5">
        {novela.resume && novela.status !== "COMING_SOON" ? (
          <Link
            href={`/assistir/${novela.resume.episodeId}`}
            className="tap flex h-13 flex-1 flex-col items-center justify-center rounded-2xl bg-cream-50 text-ink-950"
          >
            <span className="flex items-center gap-2 text-[0.9375rem] font-bold tracking-tight">
              <IconePlay tamanho={16} />
              {novela.resume.label}
            </span>
            {novela.resume.percent > 0 ? (
              <span className="text-[0.6875rem] font-semibold text-ink-950/60">
                T{novela.resume.seasonNumber} · Ep. {novela.resume.episodeNumber}{" "}
                · {novela.resume.percent}%
              </span>
            ) : null}
          </Link>
        ) : (
          <div className="flex h-13 flex-1 items-center justify-center rounded-2xl border border-white/12 bg-white/5 text-[0.9375rem] font-semibold text-cream-400">
            Estreia em breve
          </div>
        )}

        <button
          type="button"
          onClick={marcarLista}
          disabled={salvando}
          aria-pressed={favorito}
          aria-label={favorito ? "Remover da minha lista" : "Adicionar à minha lista"}
          className={`tap grid size-13 place-items-center rounded-2xl border transition-colors ${
            favorito
              ? "border-rose-500/50 bg-rose-600/20 text-rose-400"
              : "border-white/12 bg-white/6 text-cream-200"
          }`}
        >
          {favorito ? (
            <IconeCoracao tamanho={21} preenchido />
          ) : (
            <IconeCoracao tamanho={21} />
          )}
        </button>
      </div>

      {/* Trailer ---------------------------------------------------------
          Some por completo quando não há: um botão desabilitado anunciaria
          um recurso que esta novela não tem. */}
      {novela.trailer ? (
        <div className="mt-2.5 px-5">
          <button
            type="button"
            onClick={() => setTrailerAberto(true)}
            aria-haspopup="dialog"
            className="tap flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/6 text-[0.875rem] font-semibold text-cream-200"
          >
            <IconePlay tamanho={14} />
            Assistir trailer
          </button>
        </div>
      ) : null}

      {novela.trailer ? (
        <PlayerTrailer
          aberto={trailerAberto}
          aoFechar={() => setTrailerAberto(false)}
          url={novela.trailer.url}
          poster={novela.trailer.poster}
          titulo={novela.title}
        />
      ) : null}

      {/* Sinopse --------------------------------------------------------- */}
      <div className="mt-6 px-5">
        <p
          className={`selectable text-[0.9375rem] leading-relaxed text-cream-200 ${
            sinopseAberta ? "" : "line-clamp-3"
          }`}
        >
          {novela.synopsis}
        </p>
        <button
          type="button"
          onClick={() => setSinopseAberta((v) => !v)}
          className="tap -mx-1 mt-0.5 px-1 py-2 text-[0.8125rem] font-semibold text-rose-400"
        >
          {sinopseAberta ? "Mostrar menos" : "Ler mais"}
        </button>
      </div>

      {/* Elenco ---------------------------------------------------------- */}
      {novela.cast.length > 0 ? (
        <section className="mt-7">
          <p className="eyebrow mb-2.5 px-5">Elenco</p>
          <div className="rail no-scrollbar">
            {novela.cast.map((pessoa) => (
              <div
                key={pessoa.name}
                className="rail-item w-[8.5rem] rounded-card border border-white/8 bg-white/[0.03] p-3"
              >
                <p className="text-[0.8125rem] font-semibold leading-snug text-cream-50">
                  {pessoa.name}
                </p>
                {/* Sem papel, sem linha: a origem do catálogo importado dá o
                    nome de quem atua, não o personagem. */}
                {pessoa.role ? (
                  <p className="mt-0.5 text-[0.75rem] leading-snug text-cream-600">
                    {pessoa.role}
                  </p>
                ) : null}
              </div>
            ))}
            <span className="w-1 shrink-0" aria-hidden />
          </div>
        </section>
      ) : null}

      {/* Episódios ------------------------------------------------------- */}
      <section className="mt-8">
        <div className="px-5">
          <p className="eyebrow">Episódios</p>
          {novela.seasons.length > 1 ? (
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {novela.seasons.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTemporada(item.number)}
                  aria-pressed={item.number === temporada}
                  className={`tap shrink-0 rounded-full border px-3.5 py-2 text-[0.8125rem] font-semibold transition-colors ${
                    item.number === temporada
                      ? "border-transparent bg-cream-50 text-ink-950"
                      : "border-white/12 bg-white/5 text-cream-200"
                  }`}
                >
                  Temporada {item.number}
                </button>
              ))}
            </div>
          ) : null}
          {temporadaAtual?.synopsis ? (
            <p className="selectable mt-2.5 text-[0.875rem] leading-relaxed text-cream-400">
              {temporadaAtual.synopsis}
            </p>
          ) : null}
        </div>

        <ul className="mt-3">
          {temporadaAtual?.episodes.map((episodio) => {
            const bloqueado = episodio.locked;
            const conteudo = (
              <>
                <div
                  className="relative w-[7.5rem] shrink-0 overflow-hidden rounded-xl border border-white/8"
                  style={{ aspectRatio: "16 / 9" }}
                >
                  <img
                    src={episodio.thumbUrl}
                    alt=""
                    loading="lazy"
                    className={`absolute inset-0 size-full object-cover ${
                      bloqueado ? "opacity-45" : ""
                    }`}
                  />
                  <span className="absolute bottom-1 right-1 rounded bg-ink-950/80 px-1.5 py-0.5 text-[0.625rem] font-bold text-cream-200">
                    {formatClock(episodio.durationSec)}
                  </span>
                  {bloqueado ? (
                    <span className="absolute inset-0 grid place-items-center text-gold-400">
                      <IconeCadeado tamanho={20} />
                    </span>
                  ) : episodio.progress?.completed ? (
                    <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-jade-400 text-ink-950">
                      <IconeCheck tamanho={12} />
                    </span>
                  ) : null}
                  {episodio.progress && !episodio.progress.completed ? (
                    <span className="absolute inset-x-1 bottom-1">
                      <BarraProgresso
                        percent={episodio.progress.percent}
                        cor={novela.accent}
                      />
                    </span>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[0.75rem] font-bold text-gold-400">
                      {episodio.number}
                    </span>
                    <h3 className="truncate text-[0.9375rem] leading-snug">
                      {episodio.title}
                    </h3>
                  </div>
                  <p
                    className={`mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-cream-400 ${
                      esconderSpoiler && episodio.number > 3 ? "" : ""
                    }`}
                  >
                    {episodio.synopsis}
                  </p>
                  {bloqueado ? (
                    <p className="mt-1.5 text-[0.75rem] font-semibold text-gold-400">
                      {episodio.lockReason === "precisa-conta"
                        ? "Entre para assistir"
                        : "Assine ou compre esta novela"}
                    </p>
                  ) : null}
                </div>
              </>
            );

            return (
              <li key={episodio.id}>
                {bloqueado ? (
                  <Link
                    href={`/novela/${novela.slug}#desbloquear`}
                    className="tap flex items-start gap-3.5 px-5 py-3"
                  >
                    {conteudo}
                  </Link>
                ) : (
                  <Link
                    href={`/assistir/${episodio.id}`}
                    className="tap flex items-start gap-3.5 px-5 py-3"
                  >
                    {conteudo}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}
