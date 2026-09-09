"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { registrarCliqueBusca } from "@/lib/actions/catalogo";
import { EstadoVazio, Esqueleto, Selo } from "@/components/ui/primitivos";
import { IconeBusca, IconeFechar, IconeHistorico } from "@/components/ui/icones";
import type { SearchOutcome } from "@/lib/repositories/busca";

/**
 * Busca.
 *
 * Resultados a cada tecla (com folga de 220 ms) e registro do termo só quando
 * a digitação para — é o termo pensado que interessa à métrica, não o rascunho.
 * Os últimos termos ficam no aparelho; nada disso precisa ir ao servidor.
 */

const CHAVE_RECENTES = "nvl.buscas-recentes";
const MAX_RECENTES = 6;

type Props = {
  populares: { slug: string; title: string; accent: string }[];
  tags: string[];
  buscados: string[];
  generos: { slug: string; name: string; accent: string }[];
};

function lerRecentes(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_RECENTES);
    return bruto ? (JSON.parse(bruto) as string[]).slice(0, MAX_RECENTES) : [];
  } catch {
    return [];
  }
}

export function PainelBusca({ populares, tags, buscados, generos }: Props) {
  const { track } = useTelemetry();
  const campoRef = useRef<HTMLInputElement>(null);
  const [termo, setTermo] = useState("");
  const [resultado, setResultado] = useState<SearchOutcome | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [recentes, setRecentes] = useState<string[]>([]);

  useEffect(() => {
    setRecentes(lerRecentes());
  }, []);

  const guardarRecente = useCallback((valor: string) => {
    const limpo = valor.trim();
    if (limpo.length < 2) return;
    setRecentes((atual) => {
      const proximo = [limpo, ...atual.filter((item) => item !== limpo)].slice(
        0,
        MAX_RECENTES,
      );
      try {
        window.localStorage.setItem(CHAVE_RECENTES, JSON.stringify(proximo));
      } catch {
        /* modo privado */
      }
      return proximo;
    });
  }, []);

  // Busca com folga curta; o registro do termo espera a digitação parar.
  useEffect(() => {
    const consulta = termo.trim();
    if (consulta.length < 2) {
      setResultado(null);
      setCarregando(false);
      return;
    }

    setCarregando(true);
    const controlador = new AbortController();
    const rapida = window.setTimeout(() => {
      void fetch(`/api/busca?q=${encodeURIComponent(consulta)}`, {
        signal: controlador.signal,
      })
        .then((resposta) => resposta.json())
        .then((dados: SearchOutcome) => {
          setResultado(dados);
          setCarregando(false);
        })
        .catch(() => {});
    }, 220);

    const registro = window.setTimeout(() => {
      void fetch(
        `/api/busca?q=${encodeURIComponent(consulta)}&registrar=1`,
      ).catch(() => {});
      guardarRecente(consulta);
    }, 1300);

    return () => {
      controlador.abort();
      window.clearTimeout(rapida);
      window.clearTimeout(registro);
    };
  }, [termo, guardarRecente]);

  const aoAbrirResultado = (novelaId: string, posicao: number) => {
    track("SEARCH_RESULT_CLICK", {
      novelaId,
      payload: { termo: termo.trim(), posicao },
    });
    void registrarCliqueBusca(termo.trim(), novelaId);
    guardarRecente(termo);
  };

  const limparRecentes = () => {
    setRecentes([]);
    try {
      window.localStorage.removeItem(CHAVE_RECENTES);
    } catch {
      /* modo privado */
    }
  };

  const temTermo = termo.trim().length >= 2;

  return (
    <div>
      {/* Campo ------------------------------------------------------------ */}
      <div
        className="sticky top-0 z-40 border-b border-white/8 bg-ink-950/92 px-5 pb-3.5 backdrop-blur-xl"
        style={{ paddingTop: "calc(var(--safe-t) + 1rem)" }}
      >
        <h1 className="mb-3 text-[1.625rem] leading-tight">Buscar</h1>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cream-600">
            <IconeBusca tamanho={19} />
          </span>
          <input
            ref={campoRef}
            value={termo}
            onChange={(evento) => setTermo(evento.target.value)}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Buscar novelas, temas ou elenco"
            placeholder="Novela, tema, elenco…"
            className="h-12 w-full rounded-2xl border border-white/12 bg-white/[0.05] pl-11 pr-11 text-[1rem] text-cream-50 outline-none transition-colors placeholder:text-cream-600 focus:border-rose-500/70"
          />
          {termo ? (
            <button
              type="button"
              onClick={() => {
                setTermo("");
                campoRef.current?.focus();
              }}
              aria-label="Limpar busca"
              className="tap absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-xl text-cream-400"
            >
              <IconeFechar tamanho={17} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Resultados ------------------------------------------------------- */}
      {temTermo ? (
        <div className="pt-4">
          {carregando && !resultado ? (
            <ul className="space-y-3 px-5">
              {[0, 1, 2, 3].map((linha) => (
                <li key={linha} className="flex gap-3.5">
                  <Esqueleto className="h-[6.375rem] w-[4.25rem]" />
                  <div className="flex-1 space-y-2 pt-1">
                    <Esqueleto className="h-4 w-2/3" />
                    <Esqueleto className="h-3 w-full" />
                    <Esqueleto className="h-3 w-1/3" />
                  </div>
                </li>
              ))}
            </ul>
          ) : resultado && resultado.novelas.length === 0 ? (
            <EstadoVazio
              icone={<IconeBusca tamanho={24} />}
              titulo={`Nada por “${termo.trim()}”`}
              descricao="Tente o nome da novela, um tema como “vingança” ou o nome de alguém do elenco."
              acao={
                <div className="flex flex-wrap justify-center gap-1.5">
                  {generos.slice(0, 4).map((genero) => (
                    <Link
                      key={genero.slug}
                      href={`/generos/${genero.slug}`}
                      className="tap rounded-full border border-white/12 bg-white/6 px-3.5 py-2 text-[0.8125rem] font-semibold text-cream-200"
                    >
                      {genero.name}
                    </Link>
                  ))}
                </div>
              }
            />
          ) : resultado ? (
            <>
              <p className="px-5 pb-1 text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-cream-600">
                {resultado.novelas.length}{" "}
                {resultado.novelas.length === 1 ? "resultado" : "resultados"}
              </p>
              <ul>
                {resultado.novelas.map((hit, posicao) => (
                  <li key={hit.id}>
                    <Link
                      href={`/novela/${hit.slug}`}
                      onClick={() => aoAbrirResultado(hit.id, posicao)}
                      className="tap flex items-center gap-3.5 px-5 py-2.5"
                    >
                      <div
                        className="relative w-[4.25rem] shrink-0 overflow-hidden rounded-xl border border-white/8"
                        style={{ aspectRatio: "2 / 3" }}
                      >
                        <img
                          src={hit.posterUrl}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 size-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-[1.0625rem] leading-snug">
                          {hit.title}
                        </h2>
                        <p className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-cream-400">
                          {hit.tagline}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-medium text-cream-600">
                          <span>{hit.year}</span>
                          <span aria-hidden>·</span>
                          <span>{hit.episodeCount} eps.</span>
                          {hit.matchedOn !== "titulo" ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>
                                achado por{" "}
                                {hit.matchedOn === "elenco" ? "elenco" : "tema"}
                              </span>
                            </>
                          ) : null}
                          {hit.openAccess ? (
                            <Selo tom="jade">Grátis</Selo>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {resultado.genres.length > 0 ? (
                <div className="mt-5 px-5">
                  <p className="eyebrow mb-2">Gêneros relacionados</p>
                  <div className="flex flex-wrap gap-1.5">
                    {resultado.genres.map((genero) => (
                      <Link
                        key={genero.slug}
                        href={`/generos/${genero.slug}`}
                        className="tap rounded-full border border-white/12 bg-white/6 px-3.5 py-2 text-[0.8125rem] font-semibold text-cream-200"
                      >
                        {genero.name}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        /* Sem termo: sugestões honestas ------------------------------------ */
        <div className="space-y-7 pt-6">
          {recentes.length > 0 ? (
            <section>
              <div className="mb-2.5 flex items-center justify-between px-5">
                <p className="eyebrow">Suas últimas buscas</p>
                <button
                  type="button"
                  onClick={limparRecentes}
                  className="tap text-[0.75rem] font-semibold text-cream-600"
                >
                  Limpar
                </button>
              </div>
              <ul className="px-5">
                {recentes.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => setTermo(item)}
                      className="tap flex w-full items-center gap-3 py-2.5 text-left"
                    >
                      <span className="text-cream-600">
                        <IconeHistorico tamanho={17} />
                      </span>
                      <span className="flex-1 truncate text-[0.9375rem] text-cream-200">
                        {item}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {buscados.length > 0 ? (
            <section className="px-5">
              <p className="eyebrow mb-2.5">A comunidade está procurando</p>
              <div className="flex flex-wrap gap-1.5">
                {buscados.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTermo(item)}
                    className="tap rounded-full border border-white/12 bg-white/6 px-3.5 py-2 text-[0.8125rem] font-semibold text-cream-200"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="px-5">
            <p className="eyebrow mb-2.5">Temas que rendem</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTermo(tag)}
                  className="tap rounded-full border border-white/12 bg-white/6 px-3.5 py-2 text-[0.8125rem] font-semibold text-cream-200"
                >
                  {tag}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="eyebrow mb-2.5 px-5">Mais vistas do plantão</p>
            <ol className="px-5">
              {populares.map((novela, indice) => (
                <li key={novela.slug}>
                  <Link
                    href={`/novela/${novela.slug}`}
                    className="tap flex items-center gap-3.5 py-2.5"
                  >
                    <span
                      className="w-6 text-center font-display text-[1.25rem] font-semibold"
                      style={{ color: novela.accent }}
                    >
                      {indice + 1}
                    </span>
                    <span className="flex-1 truncate text-[0.9375rem] text-cream-200">
                      {novela.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}
