"use client";

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useTransform,
  type MotionValue,
  type Transition,
} from "motion/react";

import { PEDIR_CONTA } from "./ConviteConta";
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
import {
  atualizarConversa,
  buscarConversa,
  conversaGuardada,
} from "@/lib/player/conversas";
import type { LayoutDaConversa } from "@/lib/player/enquadramento";
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
 * desligada.
 *
 * E também não cobre o vídeo. O painel e a cena se movem juntos, conduzidos
 * pelo mesmo valor (`abertura`): enquanto o painel sobe, o vídeo encolhe e se
 * reenquadra na área de cima. A pessoa continua assistindo e conversando ao
 * mesmo tempo — não "parou de assistir para ler comentários".
 *
 * Por isso também não existe mais a camada invisível de tela inteira que
 * fechava o painel ao tocar fora: ela engolia qualquer toque no vídeo, e com o
 * vídeo à vista, tocar nele é pausar, não fechar. Fechar é pelo X, pelo Esc ou
 * arrastando o painel para baixo.
 *
 * A conversa tem **dois níveis**, como Instagram e TikTok. Respostas de
 * respostas existem, mas são achatadas na escrita e desenhadas no mesmo nível,
 * carregando "@nome" para dizer a quem se dirigem. Três níveis de recuo numa
 * tela de celular deixam a terceira coluna com largura de palavra.
 */

/**
 * Fração da altura do painel que o arrasto precisa percorrer para fechar.
 *
 * Um terço: um puxão curto de ajuste não fecha; um gesto decidido fecha. Menos
 * que isso e rolar a lista com o polegar perto do topo fecharia sem querer.
 */
const FRACAO_PARA_FECHAR = 0.3;
/**
 * Um puxão rápido fecha antes do limiar — é intenção clara. Em px/s.
 *
 * Mas só a partir de `PUXAO_MINIMO_PX`. No celular os eventos de ponteiro
 * chegam agrupados por quadro: um arrasto moderado de 50px pode vir num único
 * evento de 16ms e parecer um arremesso de 3000px/s. Sem distância mínima, um
 * ajuste de posição fecharia a conversa.
 */
const VELOCIDADE_PARA_FECHAR = 800;
const PUXAO_MINIMO_PX = 64;
/** Janela sobre a qual a velocidade do dedo é medida. */
const JANELA_DE_VELOCIDADE_MS = 100;

type Estado = "carregando" | "pronto" | "erro";

/** Um comentário à espera do servidor, sabendo em qual conversa ele mora. */
type Pendente = ComentarioDeEpisodio & {
  raizId: string | null;
  episodioId: string;
};

const carregarRaizes = (episodioId: string) =>
  carregarComentarios(episodioId).then((r) => r.comentarios);

/**
 * Espera o painel parar antes de pintar a lista.
 *
 * A resposta do servidor costuma chegar no meio da abertura. Pintar cinquenta
 * comentários nesse instante ocupa a thread principal justo quando o motion
 * precisa dela para o próximo quadro — e o vídeo, que está se reenquadrando
 * junto, engasgaria. O esqueleto segura a posição por mais uns milissegundos
 * e a lista entra com o movimento já parado.
 */
function quandoAssentar(valor: MotionValue<number>, fazer: () => void) {
  if (!valor.isAnimating()) {
    fazer();
    return () => {};
  }
  const parar = valor.on("animationComplete", () => {
    parar();
    fazer();
  });
  return parar;
}

export function Comentarios({
  lamina,
  abertura,
  layout,
  transicao,
  viewer,
  aoFechar,
  aoRascunho,
  aoMudarTotal,
}: {
  lamina: LaminaReel;
  /** 0 fechado, 1 aberto. O mesmo valor que reenquadra o vídeo. */
  abertura: MotionValue<number>;
  layout: LayoutDaConversa;
  transicao: Transition;
  viewer: { nome: string; avatarSeed: string; avatarUrl: string | null } | null;
  aoFechar: () => void;
  /** Há texto no campo? O reel espera antes de trocar de episódio. */
  aoRascunho: (temTexto: boolean) => void;
  aoMudarTotal: (episodioId: string, total: number) => void;
}) {
  const toast = useToast();
  const episodioId = lamina.episodio.id;
  const episodioRef = useRef(episodioId);
  episodioRef.current = episodioId;

  const [raizes, setRaizes] = useState<ComentarioDeEpisodio[] | null>(() =>
    conversaGuardada<ComentarioDeEpisodio>(episodioId),
  );
  const [estado, setEstado] = useState<Estado>(() =>
    conversaGuardada(episodioId) ? "pronto" : "carregando",
  );
  const [tentativa, setTentativa] = useState(0);
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
  const [anuncio, setAnuncio] = useState("");

  const painelRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------- carregar
  //
  // O painel abre na hora, com o que já se sabe: a conversa guardada desta
  // sessão, ou o esqueleto. A busca corre em paralelo com a animação, e um
  // episódio novo — trocado com o painel aberto — recomeça do zero.
  useEffect(() => {
    setRespostas({});
    setAbertas(new Set());
    setBuscando(new Set());
    setRespondendoA(null);
    // Conversa nova começa do topo. `scrollTop` direto, e não `scrollTo`: é
    // um reposicionamento, não um movimento, e não pode rolar nada além da
    // própria lista.
    if (listaRef.current) listaRef.current.scrollTop = 0;

    const guardada = conversaGuardada<ComentarioDeEpisodio>(episodioId);
    if (guardada) {
      setRaizes(guardada);
      setEstado("pronto");
      return;
    }

    setRaizes(null);
    setEstado("carregando");
    let cancelado = false;
    let pararEspera = () => {};

    void buscarConversa(episodioId, carregarRaizes)
      .then((itens) => {
        if (cancelado) return;
        pararEspera = quandoAssentar(abertura, () => {
          if (cancelado) return;
          setRaizes(itens);
          setEstado("pronto");
        });
      })
      .catch(() => {
        if (cancelado) return;
        setEstado("erro");
        setAnuncio("Não deu para carregar os comentários.");
      });

    return () => {
      cancelado = true;
      pararEspera();
    };
  }, [abertura, episodioId, tentativa]);

  // ------------------------------------------------------------- foco
  //
  // O foco vai para o painel, e não para o campo: focar o campo abriria o
  // teclado sem ela ter pedido, e o vídeo encolheria de novo sem motivo.
  useEffect(() => {
    painelRef.current?.focus({ preventScroll: true });
  }, []);

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

  // ------------------------------------------------------------ arrastar
  //
  // O arrasto só nasce no punho e no cabeçalho. Na lista, o dedo é da lista:
  // rolar para cima até o primeiro comentário e continuar puxando não pode
  // fechar a conversa — é o gesto mais comum da tela e o mais fácil de
  // confundir com "fechar".
  //
  // O dedo move `abertura` diretamente, então o vídeo cresce de volta na
  // mesma medida em que o painel desce. Soltar decide: passou do limiar (ou
  // foi um puxão rápido), fecha; senão, a mola devolve ao lugar.
  const arrastoRef = useRef<{
    id: number;
    inicioY: number;
    inicioAbertura: number;
    /** Posições recentes do dedo, para medir velocidade numa janela e não num evento. */
    amostras: Array<{ y: number; t: number }>;
  } | null>(null);

  const aoDescerNoPunho = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (layout.lado !== "baixo") return;
      // O X fecha por clique, não é ponto de arrasto.
      if ((e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      abertura.stop();
      arrastoRef.current = {
        id: e.pointerId,
        inicioY: e.clientY,
        inicioAbertura: abertura.get(),
        amostras: [{ y: e.clientY, t: performance.now() }],
      };
    },
    [abertura, layout.lado],
  );

  const aoMoverNoPunho = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const arrasto = arrastoRef.current;
      if (!arrasto || e.pointerId !== arrasto.id) return;
      const dy = e.clientY - arrasto.inicioY;
      // Para cima não passa de aberto: esticar o painel sobre o vídeo seria
      // cobrir justamente o que ele existe para não cobrir.
      abertura.set(
        Math.min(1, Math.max(0, arrasto.inicioAbertura - dy / layout.painel)),
      );
      const agora = performance.now();
      arrasto.amostras.push({ y: e.clientY, t: agora });
      while (
        arrasto.amostras.length > 2 &&
        agora - arrasto.amostras[0]!.t > JANELA_DE_VELOCIDADE_MS
      ) {
        arrasto.amostras.shift();
      }
    },
    [abertura, layout.painel],
  );

  const aoSoltarNoPunho = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cancelado = false) => {
      const arrasto = arrastoRef.current;
      if (!arrasto || e.pointerId !== arrasto.id) return;
      arrastoRef.current = null;

      const dy = e.clientY - arrasto.inicioY;
      // Velocidade sobre a janela recente, com piso de tempo: um evento
      // isolado não vira arremesso. E um dedo que parou antes de soltar não
      // carrega velocidade nenhuma.
      const agora = performance.now();
      const primeira = arrasto.amostras[0]!;
      const ultima = arrasto.amostras[arrasto.amostras.length - 1]!;
      const parado = agora - ultima.t > 90;
      const velocidade = parado
        ? 0
        : ((ultima.y - primeira.y) /
            Math.max(ultima.t - primeira.t, JANELA_DE_VELOCIDADE_MS / 2)) *
          1000;
      const fechar =
        !cancelado &&
        (dy > layout.painel * FRACAO_PARA_FECHAR ||
          (velocidade > VELOCIDADE_PARA_FECHAR && dy >= PUXAO_MINIMO_PX));

      if (fechar) aoFechar();
      else void animate(abertura, 1, transicao);
    },
    [abertura, aoFechar, layout.painel, transicao],
  );

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
        atualizarConversa<ComentarioDeEpisodio>(episodioRef.current, (lista) =>
          lista.map((c) => (c.id === id ? muda(c) : c)),
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
      const doEpisodio = episodioRef.current;
      const r = await apagarComentario({
        commentId: item.id,
        episodeId: doEpisodio,
      }).catch(() => null);

      if (!r?.ok) {
        toast.show("Não deu para apagar agora.", "ruim");
        return;
      }

      if (raizId === null) {
        atualizarConversa<ComentarioDeEpisodio>(doEpisodio, (lista) =>
          lista.filter((c) => c.id !== item.id),
        );
        if (episodioRef.current === doEpisodio) {
          setRaizes((atual) => atual?.filter((c) => c.id !== item.id) ?? atual);
          setRespostas(({ [item.id]: _removida, ...resto }) => resto);
        }
      } else if (episodioRef.current === doEpisodio) {
        setRespostas((atual) => ({
          ...atual,
          [raizId]: (atual[raizId] ?? []).filter((c) => c.id !== item.id),
        }));
        aplicar(raizId, null, (c) => ({
          ...c,
          respostas: Math.max(0, c.respostas - 1),
        }));
      }
      aoMudarTotal(doEpisodio, r.total);
    },
    [aplicar, aoMudarTotal, toast],
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

  const ajustarAlturaDoCampo = useCallback(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    campo.style.height = `${Math.min(campo.scrollHeight, 112)}px`;
  }, []);

  const pendentesDoEpisodio = pendentes.filter((p) => p.episodioId === episodioId);
  const pendentesDeTopo = pendentesDoEpisodio.filter((p) => p.raizId === null);

  const totalVisivel =
    raizes === null
      ? lamina.social.comentarios
      : raizes.reduce((soma, r) => soma + 1 + r.respostas, 0) +
        pendentesDoEpisodio.length;

  // O painel entra pelo lado em que mora: de baixo no celular, da direita no
  // desktop. Em porcentagem da própria medida, para servir aos dois.
  const deslocamento = useTransform(abertura, (a) => `${(1 - a) * 100}%`);
  const embaixo = layout.lado === "baixo";

  return (
    <motion.section
      ref={painelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Comentários do episódio ${lamina.episodio.numero}`}
      tabIndex={-1}
      className={`fixed z-[70] flex flex-col overflow-hidden bg-ink-900 outline-none ${
        embaixo
          ? "inset-x-0 mx-auto w-full max-w-xl rounded-t-[1.25rem] border-t border-white/8 shadow-[0_-10px_30px_-18px_rgb(0_0_0/0.7)]"
          : "right-0 border-l border-white/8"
      }`}
      style={
        embaixo
          ? { bottom: layout.teclado, height: layout.painel, y: deslocamento }
          : { top: 0, bottom: 0, width: layout.painel, x: deslocamento }
      }
    >
      <Cabecalho
        total={totalVisivel}
        episodio={lamina.episodio.numero}
        arrastavel={embaixo}
        aoFechar={aoFechar}
        aoDescer={aoDescerNoPunho}
        aoMover={aoMoverNoPunho}
        aoSoltar={(e) => aoSoltarNoPunho(e)}
        aoCancelar={(e) => aoSoltarNoPunho(e, true)}
      />

      {/* Anúncios para leitor de tela: carregou, falhou, publicou. */}
      <span aria-live="polite" className="sr-only">
        {estado === "carregando" ? "Carregando comentários" : anuncio}
      </span>

      <div
        ref={listaRef}
        aria-busy={estado === "carregando"}
        // `overscroll-contain` guarda o fim da rolagem dentro da lista, e o
        // painel nem é filho do trilho: nenhum gesto aqui chega às lâminas.
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-3"
      >
        {estado === "carregando" ? (
          <EsqueletoDeConversa />
        ) : estado === "erro" ? (
          <div className="flex h-full flex-col items-center justify-center pb-6 text-center">
            <p className="text-[0.9375rem] font-semibold text-cream-200">
              Os comentários não carregaram
            </p>
            <p className="mt-1 text-[0.8125rem] text-cream-600">
              A conexão falhou por um instante. O episódio continua tocando.
            </p>
            <button
              type="button"
              onClick={() => {
                setAnuncio("");
                setTentativa((n) => n + 1);
              }}
              className="tap mt-4 inline-flex h-10 items-center rounded-full border border-white/14 bg-white/6 px-4 text-[0.8125rem] font-semibold text-cream-100"
            >
              Tentar de novo
            </button>
          </div>
        ) : (raizes?.length ?? 0) === 0 && pendentesDeTopo.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center pb-6 text-center">
            <p className="text-[0.9375rem] font-semibold text-cream-200">
              Ninguém comentou ainda
            </p>
            <p className="mt-1 text-[0.8125rem] text-cream-600">
              Seja a primeira pessoa a falar deste episódio.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {pendentesDeTopo.map((p) => (
              <li key={p.id}>
                <ItemDeComentario item={p} pendente />
              </li>
            ))}

            {(raizes ?? []).map((raiz) => {
              const pendentesDaRaiz = pendentesDoEpisodio.filter(
                (p) => p.raizId === raiz.id,
              );
              const carregadas = respostas[raiz.id] ?? [];
              const aberta = abertas.has(raiz.id) || pendentesDaRaiz.length > 0;
              const totalRespostas = raiz.respostas + pendentesDaRaiz.length;

              return (
                // `content-visibility: auto`: numa conversa longa, o navegador
                // só desenha o que está perto da tela. O resto não custa nada
                // enquanto o vídeo toca em cima.
                <li
                  key={raiz.id}
                  className="[contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]"
                >
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
                        <span aria-hidden className="h-px w-6 bg-white/18" />
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
                                    r.isOwn ? () => void apagar(r, raiz.id) : undefined
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
              layout.teclado > 0 ? "0.625rem" : "calc(var(--safe-b) + 0.625rem)",
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

          {/* `onSubmit` + transição, e não a propriedade `action`.

              Um formulário com `action` é zerado pelo React **quando a ação
              termina**. Isso apagava duas coisas que não podiam sumir: o texto
              devolvido ao campo depois de um envio que falhou, e o que ela já
              começou a escrever enquanto o comentário anterior subia. O
              `reset()` manual, no instante do envio, continua valendo. */}
          <form
            ref={formRef}
            className="flex items-end gap-2 px-3 pt-2.5"
            onSubmit={(evento) => {
              evento.preventDefault();
              const dados = new FormData(evento.currentTarget);
              startTransition(async () => {
              const texto = String(dados.get("comentario") ?? "").trim();
              if (texto.length < 2) return;

              const alvo = respondendoA;
              const raizId = alvo?.raizId ?? null;
              // O comentário pertence ao episódio em que foi escrito, mesmo que
              // a cena mude antes de o servidor responder.
              const doEpisodio = episodioRef.current;

              // `reset` no DOM e o setter otimista valem neste quadro; um
              // `useState` dentro da transição só apareceria no fim dela, e o
              // campo ficaria preenchido enquanto a rede responde.
              formRef.current?.reset();
              if (campoRef.current) campoRef.current.style.height = "";
              aoRascunho(false);

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
                  episodioId: doEpisodio,
                },
                ...atuais,
              ]);
              if (raizId === null) {
                listaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }

              const r = await comentarEpisodio({
                episodeId: doEpisodio,
                body: texto,
                responderA: alvo?.id ?? null,
              }).catch(() => null);

              if (!r?.ok) {
                // Falhou: o texto volta para o campo. Perder o que ela escreveu
                // por um soluço de rede é a pior versão possível deste erro.
                const campo = campoRef.current;
                if (campo && !campo.value) {
                  campo.value = texto;
                  ajustarAlturaDoCampo();
                  aoRascunho(true);
                }
                setAnuncio("O comentário não foi publicado. O texto voltou para o campo.");
                toast.show(
                  r?.motivo === "sem-conta"
                    ? "Entre para comentar."
                    : r?.motivo === "nao-encontrado"
                      ? "O comentário respondido não existe mais."
                      : "Não deu para publicar agora. Seu texto continua no campo.",
                  "ruim",
                );
                return;
              }

              // O alvo só é liberado depois do sucesso: limpar no envio faria
              // uma falha de rede perder a menção junto com o texto.
              setRespondendoA(null);
              setAnuncio("Comentário publicado.");

              if (raizId === null) {
                atualizarConversa<ComentarioDeEpisodio>(doEpisodio, (lista) => [
                  r.comentario,
                  ...lista,
                ]);
                if (episodioRef.current === doEpisodio) {
                  setRaizes((atual) => [r.comentario, ...(atual ?? [])]);
                }
              } else if (episodioRef.current === doEpisodio) {
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
              aoMudarTotal(doEpisodio, r.total);
              });
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
              aria-label={
                respondendoA
                  ? `Responder a ${respondendoA.nome}`
                  : "Escrever um comentário"
              }
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
                ajustarAlturaDoCampo();
                aoRascunho(e.currentTarget.value.trim().length > 0);
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
            onClick={(e) => {
              e.preventDefault();
              aoFechar();
              window.dispatchEvent(new CustomEvent(PEDIR_CONTA, { detail: "conversa" }));
            }}
            className="tap flex h-11 items-center justify-center rounded-full bg-cream-50 text-[0.875rem] font-bold text-ink-950"
          >
            Entrar para comentar
          </Link>
        </div>
      )}
    </motion.section>
  );
}

/** Punho, título e saída. Uma linha, um número, uma saída. */
function Cabecalho({
  total,
  episodio,
  arrastavel,
  aoFechar,
  aoDescer,
  aoMover,
  aoSoltar,
  aoCancelar,
}: {
  total: number;
  episodio: number;
  arrastavel: boolean;
  aoFechar: () => void;
  aoDescer: (e: React.PointerEvent<HTMLDivElement>) => void;
  aoMover: (e: React.PointerEvent<HTMLDivElement>) => void;
  aoSoltar: (e: React.PointerEvent<HTMLDivElement>) => void;
  aoCancelar: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onPointerDown={aoDescer}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoCancelar}
      // `touch-none` só onde se arrasta: é o que entrega o gesto inteiro a
      // este cabeçalho em vez de o navegador tentar rolar alguma coisa.
      className={`relative shrink-0 border-b border-white/6 ${
        arrastavel ? "cursor-grab touch-none active:cursor-grabbing" : ""
      }`}
      data-punho-da-conversa=""
    >
      {arrastavel ? (
        <span
          aria-hidden
          className="mx-auto mt-2 block h-1 w-9 rounded-full bg-white/22"
        />
      ) : null}
      <div
        className={`flex items-center justify-between px-4 pb-2.5 ${
          arrastavel ? "pt-1.5" : "pt-3.5"
        }`}
      >
        <p className="flex items-baseline gap-2 font-sans text-[0.875rem] font-semibold text-cream-100">
          <span className="tabular-nums">
            {total === 0
              ? "Comentários"
              : total === 1
                ? "1 comentário"
                : `${formatCount(total)} comentários`}
          </span>
          {/* O episódio dá contexto quando a conversa acompanha a troca de
              cena: saber de qual capítulo se está falando. */}
          <span className="text-[0.75rem] font-medium text-cream-600">
            Ep {episodio}
          </span>
        </p>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar comentários"
          className="tap -mr-1.5 grid size-9 place-items-center rounded-full text-cream-400 hover:bg-white/6 focus-visible:bg-white/8"
        >
          <IconeFechar tamanho={17} />
        </button>
      </div>
    </div>
  );
}

function EsqueletoDeConversa() {
  return (
    <ul className="space-y-4 pt-1" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex gap-2.5">
          <span className="skeleton size-8 shrink-0 rounded-full" />
          <span className="flex-1 space-y-1.5">
            <span className="skeleton block h-2.5 w-24 rounded" />
            <span
              className="skeleton block h-3 rounded"
              style={{ width: `${82 - i * 11}%` }}
            />
          </span>
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={`flex gap-2.5 py-2 ${pendente ? "opacity-60" : ""} ${
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
            {pendente ? "enviando…" : formatRelative(item.createdAt)}
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
