"use client";

import Link from "next/link";
import { useCallback, useEffect, useOptimistic, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";

import { Avatar } from "@/components/ui/primitivos";
import {
  IconeCoracaoCheio,
  IconeFechar,
  IconeOlho,
  IconeSeta,
} from "@/components/ui/icones";
import { useToast } from "@/components/sistema/ToastProvider";
import {
  apagarComentario,
  carregarComentarios,
  carregarRespostas,
  comentarEpisodio,
  curtirComentario,
} from "@/lib/actions/reel";
import { formatCount, formatRelative } from "@/lib/format";
import type { ComentarioDeEpisodio } from "@/lib/repositories/episodio-social";
import type { LaminaReel } from "@/lib/repositories/reel";

/**
 * Conversa do episódio.
 *
 * Deliberadamente **não** usa `components/ui/Folha`. A folha do app é um modal:
 * escurece o fundo, borra, trava o rolamento e assume que o que está atrás
 * parou de importar. Num reel isso está errado três vezes — o vídeo continua
 * sendo o conteúdo, continua tocando, e um véu escuro faz a tela parecer
 * desligada. Aqui a lâmina fica intacta na faixa de cima e o painel é o único
 * plano elevado.
 *
 * A conversa tem **dois níveis**, como Instagram e TikTok. Respostas de
 * respostas existem, mas são achatadas na escrita e desenhadas no mesmo nível,
 * carregando "@nome" para dizer a quem se dirigem. Três níveis de recuo numa
 * tela de celular deixam a terceira coluna com largura de palavra.
 *
 * Respostas não vêm com a lista. A maioria das conversas nunca é aberta, e
 * carregar tudo de antemão pagaria por um texto que ninguém pediu — a folha
 * precisa subir com a lista já pronta, não depois de montar a árvore inteira.
 */

/** Fração da tela que o painel ocupa. O resto continua sendo vídeo. */
const ALTURA_RELATIVA = 0.68;

/** Um comentário à espera do servidor, sabendo em qual conversa ele mora. */
type Pendente = ComentarioDeEpisodio & { raizId: string | null };

export function Comentarios({
  lamina,
  alturaTela,
  viewer,
  aoFechar,
  aoMudarTotal,
}: {
  lamina: LaminaReel;
  /** Altura travada da tela, medida uma vez pelo reel. */
  alturaTela: number | null;
  viewer: { nome: string; avatarSeed: string; avatarUrl: string | null } | null;
  aoFechar: () => void;
  aoMudarTotal: (total: number) => void;
}) {
  const toast = useToast();
  // O arrastar nasce no cabeçalho, e não na folha inteira: com a folha toda
  // arrastável, rolar a lista para cima fecharia o painel em vez de mostrar o
  // próximo comentário.
  const controleDeArrasto = useDragControls();

  const [raizes, setRaizes] = useState<ComentarioDeEpisodio[] | null>(null);
  const [respostas, setRespostas] = useState<
    Record<string, ComentarioDeEpisodio[]>
  >({});
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [buscando, setBuscando] = useState<Set<string>>(new Set());
  const [pendentes, setPendentes] = useOptimistic<Pendente[]>([]);
  const [respondendoA, setRespondendoA] = useState<{
    id: string;
    nome: string;
    raizId: string;
  } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    void carregarComentarios(lamina.episodio.id)
      .then((r) => !cancelado && setRaizes(r.comentarios))
      .catch(() => !cancelado && setRaizes([]));
    return () => {
      cancelado = true;
    };
  }, [lamina.episodio.id]);

  // Fecha com Esc. Sem trava de rolamento no `body`: o reel atrás continua uma
  // superfície viva, e travá-lo mataria o que separa este painel de um modal.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc cancela a resposta antes de fechar o painel: sair inteiro quando a
      // pessoa só queria desistir da menção é perder o texto já escrito.
      if (respondendoA) setRespondendoA(null);
      else aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar, respondendoA]);

  // ------------------------------------------------------------- teclado
  //
  // No celular o teclado sobe *por cima* de elementos fixos: sem este ajuste o
  // campo fica atrás dele e a pessoa digita às cegas. O viewport visual é o
  // único lugar que sabe a altura real do teclado.
  const [tecladoPx, setTecladoPx] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () =>
      setTecladoPx(
        Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
      );
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => {
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
    };
  }, []);

  // ------------------------------------------------------------ respostas

  const alternarRespostas = useCallback(
    async (raizId: string) => {
      if (abertas.has(raizId)) {
        setAbertas((s) => {
          const proxima = new Set(s);
          proxima.delete(raizId);
          return proxima;
        });
        return;
      }

      setAbertas((s) => new Set(s).add(raizId));
      if (respostas[raizId]) return;

      setBuscando((s) => new Set(s).add(raizId));
      const r = await carregarRespostas(raizId).catch(() => null);
      setBuscando((s) => {
        const proxima = new Set(s);
        proxima.delete(raizId);
        return proxima;
      });
      if (r) setRespostas((atual) => ({ ...atual, [raizId]: r.respostas }));
    },
    [abertas, respostas],
  );

  // --------------------------------------------------------- curtir item
  //
  // Otimista com reversão: o coração pinta no quadro do toque e volta ao que
  // era se a escrita falhar. Numa lista tocada com o polegar em movimento,
  // esperar a rede para pintar um coração é o mesmo que não ter coração.
  const aplicar = useCallback(
    (
      id: string,
      raizId: string | null,
      muda: (c: ComentarioDeEpisodio) => ComentarioDeEpisodio,
    ) => {
      if (raizId === null) {
        setRaizes((atual) =>
          atual ? atual.map((c) => (c.id === id ? muda(c) : c)) : atual,
        );
        return;
      }
      setRespostas((atual) => {
        const lista = atual[raizId];
        if (!lista) return atual;
        return {
          ...atual,
          [raizId]: lista.map((c) => (c.id === id ? muda(c) : c)),
        };
      });
    },
    [],
  );

  const curtir = useCallback(
    (item: ComentarioDeEpisodio, raizId: string | null) => {
      const antes = { curtido: item.curtido, curtidas: item.curtidas };
      aplicar(item.id, raizId, (c) => ({
        ...c,
        curtido: !c.curtido,
        curtidas: Math.max(0, c.curtidas + (c.curtido ? -1 : 1)),
      }));

      void curtirComentario(item.id)
        .then((r) => {
          if (!r.ok) throw new Error(r.motivo);
          aplicar(item.id, raizId, (c) => ({
            ...c,
            curtido: r.curtido,
            curtidas: r.curtidas,
          }));
        })
        .catch(() => {
          aplicar(item.id, raizId, (c) => ({ ...c, ...antes }));
        });
    },
    [aplicar],
  );

  // --------------------------------------------------------------- apagar
  const apagar = useCallback(
    async (item: ComentarioDeEpisodio, raizId: string | null) => {
      const r = await apagarComentario({
        commentId: item.id,
        episodeId: lamina.episodio.id,
      }).catch(() => null);

      if (!r?.ok) {
        toast.show("Não deu para apagar agora.", "ruim");
        return;
      }

      if (raizId === null) {
        setRaizes((atual) => atual?.filter((c) => c.id !== item.id) ?? atual);
        setRespostas(({ [item.id]: _removida, ...resto }) => resto);
      } else {
        setRespostas((atual) => ({
          ...atual,
          [raizId]: (atual[raizId] ?? []).filter((c) => c.id !== item.id),
        }));
        aplicar(raizId, null, (c) => ({
          ...c,
          respostas: Math.max(0, c.respostas - 1),
        }));
      }
      aoMudarTotal(r.total);
    },
    [aplicar, aoMudarTotal, lamina.episodio.id, toast],
  );

  // ------------------------------------------------------------ responder
  const responder = useCallback(
    (alvo: ComentarioDeEpisodio, raizId: string) => {
      setRespondendoA({ id: alvo.id, nome: alvo.author.name, raizId });
      // O foco vai para o campo no mesmo gesto: tocar em "Responder" e depois
      // ter que tocar no campo são dois passos para uma intenção só.
      window.setTimeout(() => campoRef.current?.focus(), 30);
    },
    [],
  );

  const totalVisivel =
    raizes === null
      ? lamina.social.comentarios
      : raizes.reduce((soma, r) => soma + 1 + r.respostas, 0) + pendentes.length;

  const altura = alturaTela
    ? `${Math.round(alturaTela * ALTURA_RELATIVA)}px`
    : `${ALTURA_RELATIVA * 100}dvh`;

  const pendentesDeTopo = pendentes.filter((p) => p.raizId === null);

  return (
    <>
      {/* Área de saída: transparente de propósito. Existe para receber o
          toque, não para escurecer nada — a cena atrás continua inteira. */}
      <button
        type="button"
        aria-label="Fechar comentários"
        onClick={aoFechar}
        className="fixed inset-0 z-[65] cursor-default"
      />

      <motion.section
        role="dialog"
        aria-modal="false"
        aria-label={`Comentários do episódio ${lamina.episodio.numero}`}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 540, damping: 44, mass: 0.7 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.32 }}
        // Arrastar só pega no cabeçalho: com a folha inteira arrastável, rolar
        // a lista para cima fecharia o painel em vez de mostrar o próximo
        // comentário.
        dragControls={controleDeArrasto}
        dragListener={false}
        onDragEnd={(_e, info) => {
          if (info.offset.y > 90 || info.velocity.y > 550) aoFechar();
        }}
        className="fixed inset-x-0 z-[70] mx-auto flex max-w-lg flex-col overflow-hidden rounded-t-[1.5rem] border-t border-white/10 bg-ink-900 shadow-[0_-1rem_2.5rem_-1rem_rgb(0_0_0/0.75)]"
        style={{ bottom: tecladoPx, height: altura }}
      >
        <Cabecalho
          total={totalVisivel}
          aoFechar={aoFechar}
          aoArrastar={(evento) => controleDeArrasto.start(evento)}
        />

        <div
          ref={listaRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-3.5"
        >
          {raizes === null ? (
            <EsqueletoDeConversa />
          ) : raizes.length === 0 && pendentesDeTopo.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center pb-10 text-center">
              <p className="text-[0.9375rem] font-semibold text-cream-200">
                Ninguém comentou ainda
              </p>
              <p className="mt-1 text-[0.8125rem] text-cream-600">
                Seja a primeira pessoa a falar deste episódio.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {pendentesDeTopo.map((p) => (
                <ItemDeComentario key={p.id} item={p} pendente />
              ))}

              {raizes.map((raiz) => {
                const pendentesDaRaiz = pendentes.filter(
                  (p) => p.raizId === raiz.id,
                );
                const carregadas = respostas[raiz.id] ?? [];
                const aberta = abertas.has(raiz.id) || pendentesDaRaiz.length > 0;
                const totalRespostas = raiz.respostas + pendentesDaRaiz.length;

                return (
                  <li key={raiz.id}>
                    <ItemDeComentario
                      item={raiz}
                      aoCurtir={() => curtir(raiz, null)}
                      aoResponder={() => responder(raiz, raiz.id)}
                      aoApagar={raiz.isOwn ? () => void apagar(raiz, null) : undefined}
                    />

                    {totalRespostas > 0 ? (
                      <div className="ml-[2.75rem]">
                        <button
                          type="button"
                          onClick={() => void alternarRespostas(raiz.id)}
                          aria-expanded={aberta}
                          className="tap flex items-center gap-2 py-1.5 text-[0.75rem] font-semibold text-cream-500"
                        >
                          <span
                            aria-hidden
                            className="h-px w-6 bg-white/18"
                          />
                          {buscando.has(raiz.id)
                            ? "Carregando…"
                            : aberta
                              ? "Ocultar respostas"
                              : `Ver ${totalRespostas} ${
                                  totalRespostas === 1 ? "resposta" : "respostas"
                                }`}
                        </button>

                        <AnimatePresence initial={false}>
                          {aberta ? (
                            <motion.ul
                              key="respostas"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                              className="overflow-hidden"
                            >
                              {carregadas.map((r) => (
                                <li key={r.id}>
                                  <ItemDeComentario
                                    item={r}
                                    compacto
                                    aoCurtir={() => curtir(r, raiz.id)}
                                    aoResponder={() => responder(r, raiz.id)}
                                    aoApagar={
                                      r.isOwn
                                        ? () => void apagar(r, raiz.id)
                                        : undefined
                                    }
                                  />
                                </li>
                              ))}
                              {pendentesDaRaiz.map((p) => (
                                <li key={p.id}>
                                  <ItemDeComentario item={p} compacto pendente />
                                </li>
                              ))}
                            </motion.ul>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Escrever ---------------------------------------------------- */}
        {viewer ? (
          <div
            className="shrink-0 border-t border-white/7"
            style={{
              // Sem teclado, respeita a área segura. Com teclado, a folga já
              // veio do deslocamento do painel — somar as duas abriria um vão.
              paddingBottom:
                tecladoPx > 0 ? "0.625rem" : "calc(var(--safe-b) + 0.625rem)",
            }}
          >
            <AnimatePresence>
              {respondendoA ? (
                <motion.div
                  key="respondendo"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 pt-2 text-[0.75rem] text-cream-500">
                    <span className="truncate">
                      Respondendo a{" "}
                      <span className="font-semibold text-rose-300">
                        {respondendoA.nome}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setRespondendoA(null)}
                      aria-label="Cancelar resposta"
                      className="tap grid size-6 shrink-0 place-items-center rounded-full text-cream-600"
                    >
                      <IconeFechar tamanho={12} />
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <form
              ref={formRef}
              className="flex items-end gap-2 px-3 pt-2.5"
              action={async (dados: FormData) => {
                const texto = String(dados.get("comentario") ?? "").trim();
                if (texto.length < 2) return;

                const alvo = respondendoA;
                const raizId = alvo?.raizId ?? null;

                // `reset` no DOM e o setter otimista valem neste quadro; um
                // `useState` dentro da transição só apareceria no fim dela, e o
                // campo ficaria preenchido enquanto a rede responde.
                formRef.current?.reset();
                if (campoRef.current) campoRef.current.style.height = "";

                setPendentes((atuais) => [
                  {
                    id: `pendente-${crypto.randomUUID()}`,
                    body: texto,
                    spoiler: false,
                    createdAt: new Date().toISOString(),
                    isOwn: true,
                    curtidas: 0,
                    curtido: false,
                    respostas: 0,
                    // Mesma regra do servidor: menção só ao responder uma
                    // resposta, nunca ao responder a raiz da conversa.
                    respondendoA:
                      alvo && alvo.id !== alvo.raizId ? alvo.nome : null,
                    author: {
                      id: "eu",
                      name: viewer.nome,
                      handle: "",
                      avatarSeed: viewer.avatarSeed,
                      avatarUrl: viewer.avatarUrl,
                    },
                    raizId,
                  },
                  ...atuais,
                ]);
                if (raizId === null) {
                  listaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                }

                const r = await comentarEpisodio({
                  episodeId: lamina.episodio.id,
                  body: texto,
                  responderA: alvo?.id ?? null,
                });

                if (!r.ok) {
                  toast.show(
                    r.motivo === "sem-conta"
                      ? "Entre para comentar."
                      : r.motivo === "nao-encontrado"
                        ? "O comentário respondido não existe mais."
                        : "Não deu para publicar agora.",
                    "ruim",
                  );
                  return;
                }

                // O alvo só é liberado depois do sucesso: limpar no envio faria
                // uma falha de rede perder a menção junto com o texto.
                setRespondendoA(null);

                if (raizId === null) {
                  setRaizes((atual) => [r.comentario, ...(atual ?? [])]);
                } else {
                  setRespostas((atual) => ({
                    ...atual,
                    [raizId]: [...(atual[raizId] ?? []), r.comentario],
                  }));
                  setAbertas((s) => new Set(s).add(raizId));
                  aplicar(raizId, null, (c) => ({
                    ...c,
                    respostas: c.respostas + 1,
                  }));
                }
                aoMudarTotal(r.total);
              }}
            >
              <Avatar
                nome={viewer.nome}
                seed={viewer.avatarSeed}
                fotoUrl={viewer.avatarUrl}
                tamanho={30}
                className="mb-1"
              />
              <textarea
                ref={campoRef}
                name="comentario"
                rows={1}
                maxLength={600}
                placeholder={
                  respondendoA
                    ? `Responder a ${respondendoA.nome}…`
                    : "Adicione um comentário…"
                }
                // `peer` + `:placeholder-shown` fazem o botão de enviar existir
                // só quando há algo para enviar, sem estado em React e sem um
                // quadro de atraso.
                className="peer selectable max-h-28 min-h-10 flex-1 resize-none rounded-[1.25rem] bg-white/8 px-4 py-2.5 text-[0.875rem] leading-snug text-cream-50 placeholder:text-cream-600 focus:bg-white/11"
                onInput={(e) => {
                  const campo = e.currentTarget;
                  campo.style.height = "auto";
                  campo.style.height = `${Math.min(campo.scrollHeight, 112)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Publicar comentário"
                className="tap mb-0.5 hidden size-9 shrink-0 place-items-center rounded-full bg-rose-600 text-white peer-[:not(:placeholder-shown)]:grid"
              >
                <IconeSeta tamanho={16} className="-rotate-90" />
              </button>
            </form>
          </div>
        ) : (
          <div
            className="shrink-0 border-t border-white/7 px-4 pt-3"
            style={{ paddingBottom: "calc(var(--safe-b) + 0.75rem)" }}
          >
            <Link
              href="/entrar"
              className="tap flex h-11 items-center justify-center rounded-full bg-cream-50 text-[0.875rem] font-bold text-ink-950"
            >
              Entrar para comentar
            </Link>
          </div>
        )}
      </motion.section>
    </>
  );
}

/** Punho e contagem. Uma linha, um número, uma saída. */
function Cabecalho({
  total,
  aoFechar,
  aoArrastar,
}: {
  total: number;
  aoFechar: () => void;
  aoArrastar: (evento: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={aoArrastar}
      className="relative shrink-0 touch-none border-b border-white/7"
    >
      <span
        aria-hidden
        className="mx-auto mt-2.5 block h-1 w-9 rounded-full bg-white/22"
      />
      <div className="flex items-center justify-center px-3 pb-2.5 pt-2">
        <p className="font-sans text-[0.8125rem] font-semibold tabular-nums text-cream-200">
          {total === 0
            ? "Comentários"
            : total === 1
              ? "1 comentário"
              : `${formatCount(total)} comentários`}
        </p>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar"
          className="tap absolute right-2 grid size-8 place-items-center rounded-full text-cream-500"
        >
          <IconeFechar tamanho={16} />
        </button>
      </div>
    </div>
  );
}

function EsqueletoDeConversa() {
  return (
    <ul className="space-y-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex gap-2.5">
          <span className="skeleton size-8 shrink-0 rounded-full" />
          <span
            className="skeleton h-8 rounded-lg"
            style={{ width: `${74 - i * 9}%` }}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Um comentário.
 *
 * A curtida fica à direita, fora da coluna de texto, porque ela é tocada com o
 * polegar durante a leitura — se dividisse a linha com "Responder" as duas
 * viveriam a um erro de mira uma da outra.
 */
function ItemDeComentario({
  item,
  compacto = false,
  pendente = false,
  aoCurtir,
  aoResponder,
  aoApagar,
}: {
  item: ComentarioDeEpisodio;
  /** Resposta: avatar menor e recuo. */
  compacto?: boolean;
  /** À espera do servidor. */
  pendente?: boolean;
  aoCurtir?: () => void;
  aoResponder?: () => void;
  aoApagar?: () => void;
}) {
  const [revelado, setRevelado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex gap-2.5 py-2 ${pendente ? "opacity-50" : ""} ${
        compacto ? "pl-[2.75rem]" : ""
      }`}
    >
      <Avatar
        nome={item.author.name}
        seed={item.author.avatarSeed}
        fotoUrl={item.author.avatarUrl}
        tamanho={compacto ? 26 : 32}
      />

      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span className="truncate text-[0.75rem] font-semibold text-cream-500">
            {item.author.name}
          </span>
          <span className="shrink-0 text-[0.6875rem] text-cream-600">
            {formatRelative(item.createdAt)}
          </span>
        </p>

        {item.spoiler && !revelado ? (
          <button
            type="button"
            onClick={() => setRevelado(true)}
            className="tap mt-1 flex items-center gap-1.5 rounded-lg bg-white/6 px-2.5 py-1.5 text-[0.75rem] font-semibold text-gold-400"
          >
            <IconeOlho tamanho={13} fechado />
            Spoiler · tocar para ver
          </button>
        ) : (
          <p className="selectable mt-0.5 whitespace-pre-wrap break-words text-[0.875rem] leading-snug text-cream-100">
            {/* A menção é desenhada a partir da chave gravada, não recortada do
                texto: quem trocar de nome não deixa menções velhas para trás. */}
            {item.respondendoA ? (
              <span className="font-semibold text-rose-300">
                @{item.respondendoA}{" "}
              </span>
            ) : null}
            {item.body}
          </p>
        )}

        {!pendente ? (
          <div className="mt-1 flex items-center gap-4">
            {aoResponder ? (
              <button
                type="button"
                onClick={aoResponder}
                className="tap text-[0.75rem] font-semibold text-cream-500"
              >
                Responder
              </button>
            ) : null}

            {aoApagar ? (
              confirmando ? (
                <span className="flex items-center gap-3 text-[0.75rem]">
                  <button
                    type="button"
                    onClick={aoApagar}
                    className="tap font-bold text-[#f5624d]"
                  >
                    Apagar mesmo
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(false)}
                    className="tap text-cream-600"
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  className="tap text-[0.75rem] font-semibold text-cream-600"
                >
                  Apagar
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {aoCurtir ? (
        <button
          type="button"
          onClick={aoCurtir}
          aria-label={item.curtido ? "Descurtir comentário" : "Curtir comentário"}
          aria-pressed={item.curtido}
          className="tap flex w-7 shrink-0 flex-col items-center gap-0.5 pt-1"
        >
          <IconeCoracaoCheio
            tamanho={15}
            className={item.curtido ? "text-rose-500" : "text-cream-600"}
          />
          <span className="text-[0.625rem] font-semibold tabular-nums text-cream-600">
            {item.curtidas > 0 ? formatCount(item.curtidas) : ""}
          </span>
        </button>
      ) : null}
    </motion.div>
  );
}
