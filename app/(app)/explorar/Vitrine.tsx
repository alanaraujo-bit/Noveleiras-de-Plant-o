"use client";

import Link from "next/link";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { registrarCliqueBusca } from "@/lib/actions/catalogo";
import { ouvirAbaReativada } from "@/lib/shell/aba-reativada";
import {
  Avatar,
  BarraProgresso,
  BotaoLink,
  EstadoVazio,
  Esqueleto,
  Selo,
} from "@/components/ui/primitivos";
import {
  IconeBusca,
  IconeFechar,
  IconeHistorico,
  IconePlay,
} from "@/components/ui/icones";
import { episodeLabel, formatClock } from "@/lib/format";
import type { TemaVitrine } from "@/lib/repositories/catalog";
import type { ContinueItem } from "@/lib/repositories/progresso";
import type { SearchOutcome } from "@/lib/repositories/busca";

/**
 * Vitrine do Explorar.
 *
 * Uma grade só, reordenada pelos filtros. A pessoa não precisa adivinhar em
 * qual trilho a novela está: ela escolhe o critério e a grade se rearranja na
 * frente dela — as capas que continuam na lista deslizam para o lugar novo,
 * as que saem somem, as que chegam sobem. É esse movimento que explica o que
 * o filtro fez, sem precisar de texto.
 */

const ROTA = "/explorar";
const LOTE = 24;
const MAX_CURTINHA = 20;
const EASE = [0.22, 1, 0.36, 1] as const;

const CHAVE_RECENTES = "nvl.buscas-recentes";
const MAX_RECENTES = 6;

type Assinatura = {
  episodiosGratis: number;
  mensal: string;
  anual: string;
};

/**
 * O que a grade realmente lê de cada novela. A vitrine leva o catálogo
 * inteiro para o aparelho, então cada campo a mais pesa duzentas vezes.
 */
export type ItemVitrine = {
  id: string;
  slug: string;
  title: string;
  posterUrl: string;
  episodeCount: number;
  openAccess: boolean;
  viewCount: number;
  releasedAt: string;
  temas: string[];
};

type Props = {
  /** `null` para visitante: a vitrine e a busca não dependem de conta. */
  pessoa: { nome: string; avatarSeed: string; avatarUrl?: string | null } | null;
  reduzirMovimento: boolean;
  novelas: ItemVitrine[];
  temas: TemaVitrine[];
  paraVoce: string[] | null;
  continuar: ContinueItem | null;
  buscados: string[];
  filtroInicial: string | null;
  abrirBusca: boolean;
  assinatura: Assinatura | null;
};

type Ordenacao = "alta" | "voce" | "novas" | "curtas";

type Criterio = {
  chave: string;
  rotulo: string;
  titulo: string;
  linha: string;
  cor?: string;
};

// ------------------------------------------------------------- utilidades

function chegouHa(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "Chegou hoje";
  if (dias === 1) return "Chegou ontem";
  if (dias < 30) return `Chegou há ${dias} dias`;
  return "Chegou há mais de um mês";
}

function lerRecentes(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_RECENTES);
    return bruto ? (JSON.parse(bruto) as string[]).slice(0, MAX_RECENTES) : [];
  } catch {
    return [];
  }
}

/**
 * Movimento reduzido vale por dois caminhos: o do sistema e o que a pessoa
 * marcou dentro do app. O CSS já obedece aos dois; as animações em JS não.
 *
 * A preferência chega do servidor já no primeiro render — se dependesse só do
 * atributo que `AplicarPreferencias` grava num efeito, a cascata de entrada
 * rodaria antes dele. O atributo continua valendo para mudanças ao vivo.
 */
function useMovimentoReduzido(inicial: boolean): boolean {
  const sistema = useReducedMotion();
  const [noApp, setNoApp] = useState(inicial);

  useEffect(() => {
    const raiz = document.documentElement;
    const ler = () => {
      if (raiz.dataset.movimento) setNoApp(raiz.dataset.movimento === "reduzido");
    };
    ler();
    const observador = new MutationObserver(ler);
    observador.observe(raiz, {
      attributes: true,
      attributeFilter: ["data-movimento"],
    });
    return () => observador.disconnect();
  }, []);

  return Boolean(sistema) || noApp;
}

// ---------------------------------------------------------------- vitrine

export function Vitrine({
  pessoa,
  reduzirMovimento,
  novelas,
  temas,
  paraVoce,
  continuar,
  buscados,
  filtroInicial,
  abrirBusca,
  assinatura,
}: Props) {
  const reduzido = useMovimentoReduzido(reduzirMovimento);

  // Critérios -----------------------------------------------------------
  const curtinhas = useMemo(
    () => novelas.filter((n) => n.episodeCount <= MAX_CURTINHA),
    [novelas],
  );

  const ordenacoes = useMemo(() => {
    const lista: (Criterio & { chave: Ordenacao })[] = [
      {
        chave: "alta",
        rotulo: "Em alta",
        titulo: "Em alta no plantão",
        linha: "As mais assistidas agora",
      },
    ];
    if (paraVoce) {
      lista.push({
        chave: "voce",
        rotulo: "Para você",
        titulo: "Para você",
        linha: "Parecidas com o que você tem assistido",
      });
    }
    lista.push({
      chave: "novas",
      rotulo: "Novidades",
      titulo: "Novidades",
      linha: "As que acabaram de chegar",
    });
    if (curtinhas.length >= 4) {
      lista.push({
        chave: "curtas",
        rotulo: "Curtinhas",
        titulo: "Curtinhas",
        linha: `Até ${MAX_CURTINHA} episódios — dá para terminar hoje`,
      });
    }
    return lista;
  }, [paraVoce, curtinhas.length]);

  const criterios = useMemo<Criterio[]>(
    () => [
      ...ordenacoes,
      ...temas.map((tema) => ({
        chave: tema.slug,
        rotulo: tema.name,
        titulo: tema.name,
        linha: tema.tagline,
        cor: tema.accent,
      })),
    ],
    [ordenacoes, temas],
  );

  const temaPorSlug = useMemo(
    () => new Map(temas.map((tema) => [tema.slug, tema])),
    [temas],
  );

  /**
   * O tema que vai na legenda é o mais raro da novela, não o primeiro: quase
   * tudo cai em "Romance Proibido", e uma legenda que repete em todo cartão
   * não ajuda ninguém a escolher.
   */
  const temaQueDistingue = useCallback(
    (novela: ItemVitrine, filtroAtual: string) => {
      let escolhido: TemaVitrine | null = null;
      for (const slug of novela.temas) {
        const tema = temaPorSlug.get(slug);
        if (!tema || slug === filtroAtual) continue;
        if (!escolhido || tema.total < escolhido.total) escolhido = tema;
      }
      return escolhido?.name ?? null;
    },
    [temaPorSlug],
  );

  const [filtro, setFiltro] = useState(() =>
    criterios.some((c) => c.chave === filtroInicial) ? filtroInicial! : "alta",
  );
  const criterio = criterios.find((c) => c.chave === filtro) ?? criterios[0];

  const lista = useMemo(() => {
    switch (filtro) {
      case "alta":
        return novelas;
      case "voce": {
        const porId = new Map(novelas.map((n) => [n.id, n]));
        return (paraVoce ?? []).flatMap((id) => porId.get(id) ?? []);
      }
      case "novas":
        return [...novelas].sort((a, b) =>
          b.releasedAt.localeCompare(a.releasedAt),
        );
      case "curtas":
        return curtinhas;
      default:
        return novelas.filter((n) => n.temas.includes(filtro));
    }
  }, [filtro, novelas, paraVoce, curtinhas]);

  // Janela de renderização: a grade cresce conforme a pessoa rola.
  const [limite, setLimite] = useState(LOTE);
  const sentinelaRef = useRef<HTMLDivElement>(null);
  const temMais = limite < lista.length;

  useEffect(() => {
    const sentinela = sentinelaRef.current;
    if (!sentinela || !temMais) return;
    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada?.isIntersecting) setLimite((atual) => atual + LOTE);
      },
      { rootMargin: "800px 0px" },
    );
    observador.observe(sentinela);
    return () => observador.disconnect();
  }, [temMais, limite]);

  // Barra de filtros fixa --------------------------------------------------
  const marcoBarraRef = useRef<HTMLDivElement>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const cabecalhoRef = useRef<HTMLDivElement>(null);
  const [presa, setPresa] = useState(false);

  useEffect(() => {
    const marco = marcoBarraRef.current;
    if (!marco) return;
    const observador = new IntersectionObserver(([entrada]) =>
      setPresa(!entrada?.isIntersecting),
    );
    observador.observe(marco);
    return () => observador.disconnect();
  }, []);

  const escolher = useCallback(
    (chave: string, alvo?: HTMLElement | null) => {
      setFiltro(chave);
      setLimite(LOTE);

      alvo?.scrollIntoView({
        behavior: reduzido ? "auto" : "smooth",
        inline: "center",
        block: "nearest",
      });

      // Quem trocou de filtro lá embaixo volta para o começo da lista nova —
      // senão estaria olhando o meio de uma grade que acabou de mudar. O
      // destino é um pixel depois do marco: parar exatamente nele deixaria a
      // barra solta, sem fundo e sem o atalho de busca.
      const marco = marcoBarraRef.current;
      if (marco) {
        const topo = marco.getBoundingClientRect().bottom + window.scrollY + 1;
        if (window.scrollY > topo) {
          window.scrollTo({ top: topo, behavior: reduzido ? "auto" : "smooth" });
        }
      }
    },
    [reduzido],
  );

  // O filtro vai para o endereço: voltar de uma novela devolve a mesma vitrine.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (filtro === "alta") url.searchParams.delete("filtro");
    else url.searchParams.set("filtro", filtro);
    url.searchParams.delete("buscar");
    window.history.replaceState(window.history.state, "", url);
  }, [filtro]);

  // Busca ---------------------------------------------------------------------
  const busca = useBusca();
  const campoRef = useRef<HTMLInputElement>(null);
  const [buscando, setBuscando] = useState(false);

  const abrirCampo = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reduzido ? "auto" : "smooth" });
    setBuscando(true);
    campoRef.current?.focus({ preventScroll: true });
  }, [reduzido]);

  const fecharBusca = useCallback(() => {
    busca.setTermo("");
    setBuscando(false);
    campoRef.current?.blur();
  }, [busca]);

  useEffect(() => {
    if (abrirBusca) abrirCampo();
    // Só na chegada: `?buscar=1` vem de quem tocou em "buscar" noutra tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tocar de novo na aba: sai da busca, depois volta ao topo, depois ao começo.
  useEffect(
    () =>
      ouvirAbaReativada(ROTA, () => {
        if (buscando) {
          fecharBusca();
        } else if (window.scrollY > 8) {
          window.scrollTo({ top: 0, behavior: reduzido ? "auto" : "smooth" });
        } else if (filtro !== "alta") {
          escolher("alta");
        } else {
          abrirCampo();
        }
      }),
    [buscando, fecharBusca, filtro, escolher, abrirCampo, reduzido],
  );

  const visiveis = lista.slice(0, limite);
  const posicaoAssinatura =
    assinatura && lista.length > 10 ? Math.min(8, visiveis.length) : -1;

  return (
    <MotionConfig reducedMotion={reduzido ? "always" : "never"}>
      {/* Cabeçalho --------------------------------------------------------- */}
      <header
        className="px-5"
        style={{ paddingTop: "calc(var(--safe-t) + 0.875rem)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[1.875rem] leading-none tracking-[-0.02em]">
            Explorar
          </h1>
          {pessoa ? (
            <Link href="/perfil" aria-label="Sua conta" className="tap p-0.5">
              <Avatar
                nome={pessoa.nome}
                seed={pessoa.avatarSeed}
                fotoUrl={pessoa.avatarUrl}
                tamanho={34}
              />
            </Link>
          ) : (
            <Link
              href="/entrar"
              className="tap rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-2 text-[0.8125rem] font-semibold text-cream-50"
            >
              Entrar
            </Link>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cream-600">
              <IconeBusca tamanho={19} />
            </span>
            <input
              ref={campoRef}
              value={busca.termo}
              onChange={(evento) => busca.setTermo(evento.target.value)}
              onFocus={() => setBuscando(true)}
              onKeyDown={(evento) => {
                if (evento.key === "Escape") fecharBusca();
              }}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Buscar novelas, temas ou elenco"
              placeholder="Novela, tema, elenco…"
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] pl-11 pr-11 text-[1rem] text-cream-50 caret-rose-400 outline-none transition-[border-color,background-color] duration-200 placeholder:text-cream-600 focus:border-rose-500/60 focus:bg-white/[0.08] [&::-webkit-search-cancel-button]:hidden"
            />
            {busca.termo ? (
              <button
                type="button"
                onClick={() => {
                  busca.setTermo("");
                  campoRef.current?.focus();
                }}
                aria-label="Limpar busca"
                className="tap absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-xl text-cream-400"
              >
                <IconeFechar tamanho={17} />
              </button>
            ) : null}
          </div>

          <AnimatePresence initial={false}>
            {buscando ? (
              <motion.button
                key="cancelar"
                type="button"
                onClick={fecharBusca}
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="tap shrink-0 overflow-hidden whitespace-nowrap py-2 pl-1 text-[0.9375rem] font-semibold text-rose-300"
              >
                Cancelar
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {buscando ? (
          <motion.div
            key="busca"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <PainelDeBusca
              busca={busca}
              buscados={buscados}
              temas={temas}
              aoEscolherTema={(slug) => {
                fecharBusca();
                escolher(slug);
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="vitrine"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            {continuar ? <Retomar item={continuar} /> : null}

            {/* Filtros ------------------------------------------------------ */}
            <div ref={marcoBarraRef} aria-hidden className="h-px" />
            <div
              ref={barraRef}
              className={`sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-300 ${
                presa
                  ? "border-b border-white/8 bg-ink-950/88 backdrop-blur-xl"
                  : "border-b border-transparent"
              }`}
              style={{ paddingTop: "var(--safe-t)" }}
            >
              <div className="flex items-center">
                <div
                  role="group"
                  aria-label="Filtrar a vitrine"
                  className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-5 py-2.5 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]"
                >
                  {criterios.map((c, indice) => (
                    <FiltroChip
                      key={c.chave}
                      criterio={c}
                      ativo={c.chave === filtro}
                      separar={indice === ordenacoes.length && temas.length > 0}
                      aoEscolher={escolher}
                    />
                  ))}
                  <span className="w-3 shrink-0" aria-hidden />
                </div>

                <AnimatePresence>
                  {presa ? (
                    <motion.button
                      type="button"
                      onClick={abrirCampo}
                      aria-label="Buscar novelas"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="tap mr-3 grid size-9 shrink-0 place-items-center rounded-full bg-white/8 text-cream-200"
                    >
                      <IconeBusca tamanho={18} />
                    </motion.button>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>

            {/* Cabeçalho do critério -------------------------------------- */}
            <div
              ref={cabecalhoRef}
              className="relative px-5 pb-4 pt-4"
              style={{ "--accent": criterio.cor ?? "var(--color-rose-500)" } as CSSProperties}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={criterio.chave}
                  initial={{ opacity: 0, x: 14, filter: "blur(4px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -10, filter: "blur(4px)" }}
                  transition={{ duration: 0.26, ease: EASE }}
                  className="flex items-end justify-between gap-4"
                >
                  <div className="min-w-0">
                    <h2 className="text-[1.375rem] leading-tight text-balance-pt">
                      {criterio.titulo}
                    </h2>
                    <p className="mt-1 text-[0.875rem] leading-snug text-cream-400">
                      {criterio.linha}
                    </p>
                  </div>
                  <p className="shrink-0 pb-0.5 text-[0.75rem] font-semibold tabular-nums text-cream-600">
                    {lista.length} {lista.length === 1 ? "novela" : "novelas"}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Grade -------------------------------------------------------- */}
            <ul className="relative grid grid-cols-2 gap-x-3 gap-y-6 px-5">
              <AnimatePresence mode="popLayout" initial>
                {visiveis.flatMap((novela, indice) => {
                  const itens = [];
                  if (indice === posicaoAssinatura && assinatura) {
                    itens.push(
                      <ItemGrade key="assinatura" indice={indice} largo>
                        <ConviteAssinatura assinatura={assinatura} />
                      </ItemGrade>,
                    );
                  }
                  // Só ganha número quem foi visto de fato: em empate no zero,
                  // "3º lugar" seria uma afirmação que o dado não sustenta.
                  const posicao =
                    filtro === "alta" && indice < 10 && novela.viewCount > 0
                      ? indice + 1
                      : null;
                  itens.push(
                    <ItemGrade key={novela.id} indice={indice}>
                      <CartaoVitrine
                        novela={novela}
                        prioridade={indice < 4}
                        posicao={posicao}
                        legenda={
                          filtro === "novas"
                            ? `${chegouHa(novela.releasedAt)} · ${novela.episodeCount} eps.`
                            : [
                                `${novela.episodeCount} eps.`,
                                temaQueDistingue(novela, filtro),
                              ]
                                .filter(Boolean)
                                .join(" · ")
                        }
                      />
                    </ItemGrade>,
                  );
                  return itens;
                })}
              </AnimatePresence>
            </ul>

            {temMais ? (
              <div ref={sentinelaRef} className="grid grid-cols-2 gap-3 px-5 pt-6">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="skeleton rounded-card"
                    style={{ aspectRatio: "2 / 3" }}
                  />
                ))}
              </div>
            ) : lista.length > 6 ? (
              <p className="px-5 pt-10 text-center text-[0.8125rem] text-cream-600">
                Isso é tudo em {criterio.rotulo.toLowerCase()}.{" "}
                <button
                  type="button"
                  onClick={abrirCampo}
                  className="tap font-semibold text-rose-300 underline decoration-rose-300/40 underline-offset-4"
                >
                  Procurar outra
                </button>
              </p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

// ---------------------------------------------------------------- peças

function FiltroChip({
  criterio,
  ativo,
  separar,
  aoEscolher,
}: {
  criterio: Criterio;
  ativo: boolean;
  separar: boolean;
  aoEscolher: (chave: string, alvo?: HTMLElement | null) => void;
}) {
  return (
    <>
      {separar ? (
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-white/12" />
      ) : null}
      <button
        type="button"
        aria-pressed={ativo}
        onClick={(evento) => aoEscolher(criterio.chave, evento.currentTarget)}
        className={`tap relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors duration-200 ${
          ativo ? "text-ink-950" : "text-cream-200 hover:text-cream-50"
        }`}
      >
        {ativo ? (
          <motion.span
            layoutId="filtro-ativo"
            transition={{ type: "spring", stiffness: 480, damping: 36 }}
            className="absolute inset-0 rounded-full bg-cream-50 shadow-[0_0.5rem_1.25rem_-0.5rem_rgb(0_0_0/0.7)]"
          />
        ) : (
          <span className="absolute inset-0 rounded-full border border-white/10 bg-white/[0.06]" />
        )}
        {criterio.cor ? (
          <span
            aria-hidden
            className="relative size-2 rounded-full"
            style={{
              background: criterio.cor,
              boxShadow: ativo ? "none" : `0 0 0.5rem ${criterio.cor}`,
            }}
          />
        ) : null}
        <span className="relative">{criterio.rotulo}</span>
      </button>
    </>
  );
}

function ItemGrade({
  children,
  indice,
  largo = false,
}: {
  children: React.ReactNode;
  indice: number;
  largo?: boolean;
}) {
  // A cascata recomeça a cada lote: quem chega rolando não espera a fila toda.
  const atraso = Math.min(indice % LOTE, 9) * 0.035;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 18, scale: 0.96, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{
        opacity: 0,
        scale: 0.94,
        filter: "blur(4px)",
        transition: { duration: 0.16, ease: "easeOut" },
      }}
      transition={{
        default: { duration: 0.46, ease: EASE, delay: atraso },
        layout: { type: "spring", stiffness: 380, damping: 36 },
      }}
      className={largo ? "col-span-2" : undefined}
    >
      {children}
    </motion.li>
  );
}

function CartaoVitrine({
  novela,
  prioridade,
  posicao,
  legenda,
}: {
  novela: ItemVitrine;
  prioridade: boolean;
  posicao: number | null;
  legenda: string;
}) {
  return (
    <Link href={`/novela/${novela.slug}`} className="tap group block">
      <div
        className="relative overflow-hidden rounded-card border border-white/8 bg-ink-850 shadow-poster transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-soft)] group-hover:-translate-y-1 group-hover:shadow-lift"
        style={{ aspectRatio: "2 / 3" }}
      >
        <img
          src={novela.posterUrl}
          alt=""
          loading={prioridade ? "eager" : "lazy"}
          fetchPriority={prioridade ? "high" : "auto"}
          decoding="async"
          className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
        />
        {novela.openAccess ? (
          <div className="absolute left-2 top-2">
            <Selo tom="jade">Grátis</Selo>
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 flex gap-2 px-0.5">
        {posicao ? (
          <span
            aria-label={`${posicao}º lugar`}
            className="-mt-1 shrink-0 font-display text-[2rem] font-semibold leading-none tabular-nums text-gold-400"
            style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1' }}
          >
            {posicao}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-display text-[0.9375rem] font-semibold leading-[1.18] text-cream-50">
            {novela.title}
          </h3>
          <p className="mt-1 truncate text-[0.75rem] font-medium text-cream-600">
            {legenda}
          </p>
        </div>
      </div>
    </Link>
  );
}

function Retomar({ item }: { item: ContinueItem }) {
  const restante = Math.max(0, item.durationSec - item.positionSec);
  return (
    <div className="px-5 pt-4">
      <Link
        href={`/assistir/${item.episodeId}`}
        className="tap surface-card group flex items-center gap-3 overflow-hidden rounded-card p-2 pr-3"
      >
        <div
          className="relative w-[5.75rem] shrink-0 overflow-hidden rounded-[0.875rem]"
          style={{ aspectRatio: "16 / 10" }}
        >
          <img
            src={item.thumbUrl}
            alt=""
            loading="eager"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-x-1.5 bottom-1.5">
            <BarraProgresso percent={item.percent} cor={item.accent} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[0.75rem] font-medium text-cream-400">
            Continuar · {episodeLabel(item.seasonNumber, item.episodeNumber)}
          </p>
          <p className="mt-0.5 truncate font-display text-[1rem] font-semibold leading-tight text-cream-50">
            {item.title}
          </p>
          <p className="mt-0.5 truncate text-[0.75rem] text-cream-600">
            {item.percent > 0 ? `Faltam ${formatClock(restante)}` : "Começa agora"}
          </p>
        </div>

        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-600 text-cream-50 shadow-[0_0.5rem_1.25rem_-0.5rem_var(--color-rose-700)] transition-transform duration-300 group-hover:scale-105">
          <IconePlay tamanho={16} />
        </span>
      </Link>
    </div>
  );
}

function ConviteAssinatura({ assinatura }: { assinatura: Assinatura }) {
  return (
    <div
      className="warm-glow overflow-hidden rounded-panel border border-gold-400/20 px-5 py-6"
      style={
        {
          "--accent": "var(--color-gold-500)",
          background:
            "linear-gradient(160deg, rgb(217 163 85 / 0.16), rgb(42 21 35 / 0.92) 70%)",
        } as CSSProperties
      }
    >
      <div className="relative">
        <h3 className="text-[1.25rem] leading-tight text-balance-pt">
          Passou do {assinatura.episodiosGratis}º episódio? Continue sem parar
        </h3>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-cream-200">
          Catálogo inteiro por {assinatura.mensal} por mês, ou{" "}
          {assinatura.anual} no ano. Sem fidelidade.
        </p>
        <BotaoLink href="/planos" variante="ouro" tamanho="medio" className="mt-4">
          Ver os planos
        </BotaoLink>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- busca

/**
 * Resultados a cada tecla (com folga de 220 ms) e registro do termo só quando
 * a digitação para — é o termo pensado que interessa à métrica, não o rascunho.
 * Os últimos termos ficam no aparelho; nada disso precisa ir ao servidor.
 */
function useBusca() {
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

  const limparRecentes = useCallback(() => {
    setRecentes([]);
    try {
      window.localStorage.removeItem(CHAVE_RECENTES);
    } catch {
      /* modo privado */
    }
  }, []);

  return {
    termo,
    setTermo,
    resultado,
    carregando,
    recentes,
    guardarRecente,
    limparRecentes,
  };
}

type Busca = ReturnType<typeof useBusca>;

function PainelDeBusca({
  busca,
  buscados,
  temas,
  aoEscolherTema,
}: {
  busca: Busca;
  buscados: string[];
  temas: TemaVitrine[];
  aoEscolherTema: (slug: string) => void;
}) {
  const { track } = useTelemetry();
  const { termo, resultado, carregando } = busca;
  const temTermo = termo.trim().length >= 2;

  const aoAbrirResultado = (novelaId: string, posicao: number) => {
    track("SEARCH_RESULT_CLICK", {
      novelaId,
      payload: { termo: termo.trim(), posicao },
    });
    void registrarCliqueBusca(termo.trim(), novelaId);
    busca.guardarRecente(termo);
  };

  if (temTermo) {
    if (carregando && !resultado) {
      return (
        <ul className="space-y-3 px-5 pt-5" aria-busy>
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
      );
    }

    if (resultado && resultado.novelas.length === 0) {
      return (
        <div className="pt-6">
          <EstadoVazio
            icone={<IconeBusca tamanho={24} />}
            titulo={`Nada por “${termo.trim()}”`}
            descricao="Tente o nome da novela, um tema como “vingança” ou o nome de alguém do elenco."
          />
        </div>
      );
    }

    if (!resultado) return null;

    return (
      <div className="pt-4">
        <p className="px-5 pb-1 text-[0.75rem] font-semibold tabular-nums text-cream-600">
          {resultado.novelas.length}{" "}
          {resultado.novelas.length === 1 ? "resultado" : "resultados"}
        </p>
        <ul>
          {resultado.novelas.map((hit, posicao) => (
            <motion.li
              key={hit.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.3,
                ease: EASE,
                delay: Math.min(posicao, 8) * 0.03,
              }}
            >
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
                    {hit.openAccess ? <Selo tom="jade">Grátis</Selo> : null}
                  </div>
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      </div>
    );
  }

  // Sem termo: sugestões honestas.
  return (
    <div className="space-y-7 pt-6">
      {busca.recentes.length > 0 ? (
        <section>
          <div className="mb-1.5 flex items-center justify-between px-5">
            <h2 className="font-sans text-[0.875rem] font-bold tracking-normal text-cream-200">
              Suas últimas buscas
            </h2>
            <button
              type="button"
              onClick={busca.limparRecentes}
              className="tap py-1.5 text-[0.75rem] font-semibold text-cream-600"
            >
              Limpar
            </button>
          </div>
          <ul className="px-5">
            {busca.recentes.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => busca.setTermo(item)}
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
          <h2 className="mb-2.5 font-sans text-[0.875rem] font-bold tracking-normal text-cream-200">
            A comunidade está procurando
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {buscados.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => busca.setTermo(item)}
                className="tap rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[0.8125rem] font-semibold text-cream-200"
              >
                {item}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {temas.length > 0 ? (
        <section className="px-5">
          <h2 className="mb-2.5 font-sans text-[0.875rem] font-bold tracking-normal text-cream-200">
            Ou escolha pelo tema
          </h2>
          <ul className="grid grid-cols-2 gap-2">
            {temas.map((tema) => (
              <li key={tema.slug}>
                <button
                  type="button"
                  onClick={() => aoEscolherTema(tema.slug)}
                  className="tap relative flex w-full flex-col items-start overflow-hidden rounded-2xl border border-white/8 px-3.5 py-3 text-left"
                  style={{
                    background: `linear-gradient(150deg, color-mix(in oklab, ${tema.accent} 30%, transparent), rgb(255 255 255 / 0.03) 75%)`,
                  }}
                >
                  <span className="font-display text-[1rem] font-semibold leading-tight text-cream-50">
                    {tema.name}
                  </span>
                  <span className="mt-0.5 text-[0.75rem] tabular-nums text-cream-400">
                    {tema.total} novelas
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
