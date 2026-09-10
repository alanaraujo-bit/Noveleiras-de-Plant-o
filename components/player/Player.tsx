"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import {
  IconeCadeado,
  IconePausa,
  IconePlay,
  IconeProximo,
  IconeTelaCheia,
  IconeVoltar,
  IconeVolume,
} from "@/components/ui/icones";
import type { MotivoBloqueado } from "@/lib/access/entitlements";
import {
  renovarFonte as pedirFonteNova,
  useRegistroDeProgresso,
  useTelaAcordada,
  type Fonte as FonteCompartilhada,
} from "@/lib/player/reproducao";
import { formatClock } from "@/lib/format";

/**
 * Player de tela cheia.
 *
 * A fonte do vídeo chega pronta da página, que já decidiu o acesso no servidor
 * — o player abre tocando imediatamente. Tela cheia fica disponível no
 * controle explícito, porque o Android exibe um aviso nativo sempre que um
 * site chama a Fullscreen API automaticamente. A rota /api/midia continua
 * sendo a autoridade e serve para renovar a fonte quando ela expirar.
 *
 * Tocar, paywall e erro são três estados de primeira classe, não exceções.
 *
 * A contabilidade invisível — tempo real de tela, envio por `sendBeacon` ao
 * sair, wake lock, renovação de assinatura — vive em `lib/player/reproducao`,
 * compartilhada com as lâminas do reel. As duas telas são visualmente opostas
 * e medem exatamente a mesma coisa; duas cópias divergiriam em silêncio, e o
 * sintoma apareceria semanas depois num gráfico de tempo assistido.
 */

type EpisodioPlayer = {
  id: string;
  titulo: string;
  numero: number;
  temporada: number;
  duracaoSec: number;
  capaUrl: string;
  novela: { id: string; slug: string; titulo: string; accent: string };
};

type Proximo = {
  id: string;
  titulo: string;
  numero: number;
  temporada: number;
  capaUrl: string;
};

type Fonte = FonteCompartilhada;

type Bloqueio = MotivoBloqueado;

type Estado =
  | { nome: "pronto"; fonte: Fonte }
  | { nome: "bloqueado"; motivo: Bloqueio }
  | { nome: "erro"; mensagem: string };

const OCULTAR_CONTROLES_MS = 2800;

type DocumentoComWebkit = Document & {
  webkitExitFullscreen?: () => void;
  webkitFullscreenElement?: Element | null;
};

type VideoComWebkit = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

export function Player({
  episodio,
  fonte,
  bloqueio,
  retomarEm,
  proximo,
  autoplay,
  economiaDeDados,
}: {
  episodio: EpisodioPlayer;
  fonte: Fonte | null;
  bloqueio: Bloqueio | null;
  retomarEm: number;
  proximo: Proximo | null;
  autoplay: boolean;
  economiaDeDados: boolean;
}) {
  const router = useRouter();
  const { track, sessionId } = useTelemetry();
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { manterTelaAcordada, liberarTelaAcordada } = useTelaAcordada();

  const [estado, setEstado] = useState<Estado>(() =>
    fonte
      ? { nome: "pronto", fonte }
      : { nome: "bloqueado", motivo: bloqueio ?? "precisa-pagar" },
  );
  const [tocando, setTocando] = useState(false);
  const [mudo, setMudo] = useState(false);
  const [posicao, setPosicao] = useState(retomarEm);
  const [duracao, setDuracao] = useState(episodio.duracaoSec);
  const [bufferando, setBufferando] = useState(false);
  const [controles, setControles] = useState(true);
  const [contagem, setContagem] = useState<number | null>(null);
  const [avisoRetomada, setAvisoRetomada] = useState(retomarEm > 5);
  const [emTelaCheia, setEmTelaCheia] = useState(false);

  const ocultarRef = useRef<number | null>(null);

  const {
    enviar: enviarProgresso,
    aoAtualizarTempo: contabilizarTempo,
    marcarInicioDeContagem,
    pararContagem,
  } = useRegistroDeProgresso({
    videoRef,
    episodeId: episodio.id,
    duracaoPadraoSec: episodio.duracaoSec,
    sessionId,
    // Na tela cheia a pessoa escolheu este episódio: não existe passagem de
    // dedo para filtrar, e toda reprodução conta.
    deveGravar: () => true,
  });

  const atualizarTelaCheia = useCallback(() => {
    const documento = document as DocumentoComWebkit;
    const video = videoRef.current as VideoComWebkit | null;
    setEmTelaCheia(
      Boolean(
        document.fullscreenElement ||
          documento.webkitFullscreenElement ||
          video?.webkitDisplayingFullscreen,
      ),
    );
  }, []);

  const entrarTelaCheia = useCallback(() => {
    const player = playerRef.current;
    const video = videoRef.current as VideoComWebkit | null;
    if (!player || document.fullscreenElement) return;

    if (player.requestFullscreen) {
      void player
        .requestFullscreen({ navigationUI: "hide" })
        .then(atualizarTelaCheia)
        .catch(() => {
          // Alguns navegadores móveis só aceitam tela cheia no elemento de vídeo.
          video?.webkitEnterFullscreen?.();
          atualizarTelaCheia();
        });
      return;
    }

    video?.webkitEnterFullscreen?.();
    atualizarTelaCheia();
  }, [atualizarTelaCheia]);

  const sairTelaCheia = useCallback(() => {
    const documento = document as DocumentoComWebkit;
    const video = videoRef.current as VideoComWebkit | null;
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {});
    } else if (documento.webkitFullscreenElement) {
      documento.webkitExitFullscreen?.();
    } else if (video?.webkitDisplayingFullscreen) {
      video.webkitExitFullscreen?.();
    }
  }, []);

  const voltarDoEpisodio = useCallback(() => {
    // Interrompe explicitamente antes de navegar para que o áudio/vídeo não
    // continue vivo enquanto a tela anterior é renderizada.
    videoRef.current?.pause();
    sairTelaCheia();
    router.back();
  }, [router, sairTelaCheia]);

  useEffect(() => {
    const video = videoRef.current as VideoComWebkit | null;
    document.addEventListener("fullscreenchange", atualizarTelaCheia);
    document.addEventListener("webkitfullscreenchange", atualizarTelaCheia);
    video?.addEventListener("webkitbeginfullscreen", atualizarTelaCheia);
    video?.addEventListener("webkitendfullscreen", atualizarTelaCheia);

    return () => {
      document.removeEventListener("fullscreenchange", atualizarTelaCheia);
      document.removeEventListener("webkitfullscreenchange", atualizarTelaCheia);
      video?.removeEventListener("webkitbeginfullscreen", atualizarTelaCheia);
      video?.removeEventListener("webkitendfullscreen", atualizarTelaCheia);
    };
  }, [atualizarTelaCheia]);

  // Trocar de episódio pelo botão "próximo" reaproveita este componente:
  // o estado precisa acompanhar a nova fonte que a página entregou.
  useEffect(() => {
    setEstado(
      fonte
        ? { nome: "pronto", fonte }
        : { nome: "bloqueado", motivo: bloqueio ?? "precisa-pagar" },
    );
  }, [fonte, bloqueio]);

  /**
   * Renova a fonte pela rota de mídia e reflete o resultado no estado da tela.
   * Só é necessário quando a URL expira — o caminho normal já vem resolvido
   * do servidor.
   */
  const renovarFonte = useCallback(async () => {
    const resultado = await pedirFonteNova(episodio.id);
    if (resultado.estado === "pronto") {
      setEstado({ nome: "pronto", fonte: resultado.fonte });
      return true;
    }
    if (resultado.estado === "bloqueado") {
      setEstado({
        nome: "bloqueado",
        motivo: (resultado.motivo as Bloqueio) ?? "precisa-pagar",
      });
      return true;
    }
    return false;
  }, [episodio.id]);

  // ------------------------------------------------------------- controles
  const agendarOcultar = useCallback(() => {
    if (ocultarRef.current) window.clearTimeout(ocultarRef.current);
    ocultarRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControles(false);
    }, OCULTAR_CONTROLES_MS);
  }, []);

  const mostrarControles = useCallback(() => {
    setControles(true);
    agendarOcultar();
  }, [agendarOcultar]);

  const alternarPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
    mostrarControles();
  }, [entrarTelaCheia, mostrarControles]);

  const pular = useCallback(
    (segundos: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(
        0,
        Math.min(video.duration || duracao, video.currentTime + segundos),
      );
      track("PLAY_SEEK", {
        episodeId: episodio.id,
        novelaId: episodio.novela.id,
        payload: { segundos },
      });
      mostrarControles();
    },
    [duracao, episodio.id, episodio.novela.id, mostrarControles, track],
  );

  // Teclado, para quem estiver no computador.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.target instanceof HTMLInputElement) return;
      if (evento.code === "Space" || evento.code === "KeyK") {
        evento.preventDefault();
        alternarPlay();
      }
      if (evento.code === "ArrowRight") pular(10);
      if (evento.code === "ArrowLeft") pular(-10);
      if (evento.code === "KeyM") setMudo((v) => !v);
      if (evento.code === "Escape") voltarDoEpisodio();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alternarPlay, pular, voltarDoEpisodio]);

  // ------------------------------------------------------- autoplay do próximo
  useEffect(() => {
    if (contagem === null) return;
    if (contagem <= 0) {
      if (proximo) router.replace(`/assistir/${proximo.id}`);
      return;
    }
    const timer = window.setTimeout(() => setContagem((v) => (v ?? 1) - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [contagem, proximo, router]);

  // ------------------------------------------------------------------ vídeo

  /**
   * Posiciona o vídeo onde a pessoa parou e começa a tocar.
   *
   * Não pode depender só do evento `loadedmetadata`: o elemento vem no HTML do
   * servidor e o navegador pode carregar os metadados (ou tê-los em cache)
   * antes da hidratação, engolindo o evento e reiniciando o episódio do zero.
   * Por isso o efeito abaixo também trata o vídeo que já chegou pronto.
   */
  const retomadaAplicadaRef = useRef(false);

  const prepararVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuracao(video.duration);
    }
    if (
      !retomadaAplicadaRef.current &&
      retomarEm > 0 &&
      Number.isFinite(video.duration) &&
      retomarEm < video.duration - 2
    ) {
      retomadaAplicadaRef.current = true;
      video.currentTime = retomarEm;
    }
    if (video.paused) {
      void video.play().catch(() => {
        // Autoplay barrado pelo navegador: o cartaz e o botão grande resolvem.
        setTocando(false);
        setControles(true);
      });
    }
  }, [retomarEm]);

  useEffect(() => {
    retomadaAplicadaRef.current = false;
    const video = videoRef.current;
    if (!video) return;
    // HAVE_METADATA ou mais: a duração já é conhecida, dá para posicionar.
    if (video.readyState >= 1) prepararVideo();
  }, [episodio.id, prepararVideo]);

  const aoAtualizarTempo = () => {
    contabilizarTempo();
    const video = videoRef.current;
    if (video) setPosicao(video.currentTime);
  };

  const progresso = duracao > 0 ? (posicao / duracao) * 100 : 0;

  // ---------------------------------------------------------------- telas
  if (estado.nome === "bloqueado") {
    return (
      <TelaMensagem
        episodio={episodio}
        titulo={
          estado.motivo === "precisa-conta"
            ? "Entre para continuar assistindo"
            : "Este episódio faz parte do catálogo pago"
        }
        // Um episódio bloqueado ainda mostra a arte da cena, desfocada: a
        // pessoa vê o que está perdendo, não uma tela vazia.
        texto={
          estado.motivo === "precisa-conta"
            ? "Sua conta guarda o progresso e libera os episódios."
            : "Assine o catálogo inteiro, ou compre só esta novela e ela é sua para sempre."
        }
        icone={<IconeCadeado tamanho={26} />}
        acao={
          estado.motivo === "precisa-conta" ? (
            <Link
              href="/entrar"
              className="tap flex h-13 items-center justify-center rounded-2xl bg-cream-50 px-7 text-[0.9375rem] font-bold text-ink-950"
            >
              Entrar
            </Link>
          ) : (
            <Link
              href={`/novela/${episodio.novela.slug}#desbloquear`}
              className="tap flex h-13 items-center justify-center rounded-2xl bg-gold-400 px-7 text-[0.9375rem] font-bold text-ink-950"
            >
              Ver como desbloquear
            </Link>
          )
        }
      />
    );
  }

  if (estado.nome === "erro") {
    return (
      <TelaMensagem
        episodio={episodio}
        titulo="Não deu para tocar agora"
        texto={estado.mensagem}
        acao={
          <button
            type="button"
            onClick={() => router.refresh()}
            className="tap flex h-13 items-center justify-center rounded-2xl bg-cream-50 px-7 text-[0.9375rem] font-bold text-ink-950"
          >
            Tentar de novo
          </button>
        }
      />
    );
  }

  return (
    <div ref={playerRef} className="fixed inset-0 z-[60] bg-black">
      {estado.nome === "pronto" ? (
        <video
          ref={videoRef}
          src={estado.fonte.url}
          poster={estado.fonte.poster ?? episodio.capaUrl}
          playsInline
          muted={mudo}
          // Em economia de dados o vídeo só é buscado quando a pessoa manda
          // tocar; fora dela, os metadados vêm na frente para o player abrir
          // já sabendo a duração.
          preload={economiaDeDados ? "none" : "metadata"}
          className="size-full object-contain"
          onLoadedMetadata={prepararVideo}
          onTimeUpdate={aoAtualizarTempo}
          onWaiting={() => setBufferando(true)}
          onPlaying={() => {
            setBufferando(false);
            setTocando(true);
            manterTelaAcordada();
            marcarInicioDeContagem();
            agendarOcultar();
          }}
          onPlay={() => {
            setTocando(true);
            track("PLAY_START", {
              episodeId: episodio.id,
              novelaId: episodio.novela.id,
            });
          }}
          onPause={() => {
            setTocando(false);
            setControles(true);
            pararContagem();
            liberarTelaAcordada();
            sairTelaCheia();
            enviarProgresso();
            track("PLAY_PAUSE", {
              episodeId: episodio.id,
              novelaId: episodio.novela.id,
              valueMs: Math.round(posicao * 1000),
            });
          }}
          onEnded={() => {
            setTocando(false);
            setControles(true);
            liberarTelaAcordada();
            sairTelaCheia();
            enviarProgresso({ completo: true });
            track("PLAY_COMPLETE", {
              episodeId: episodio.id,
              novelaId: episodio.novela.id,
            });
            if (proximo) setContagem(autoplay ? 5 : null);
          }}
          onError={() => {
            track("PLAY_ERROR", {
              episodeId: episodio.id,
              novelaId: episodio.novela.id,
            });
            // Pode ser só uma URL vencida: pedimos uma nova antes de desistir.
            void renovarFonte().then((renovou) => {
              if (renovou) return;
              setEstado({
                nome: "erro",
                mensagem:
                  "O arquivo deste episódio não respondeu. Tente de novo em instantes.",
              });
            });
          }}
        />
      ) : null}

      {/* Camada de toque: um toque mostra/esconde, toque duplo pula. */}
      <button
        type="button"
        aria-label={controles ? "Esconder controles" : "Mostrar controles"}
        onClick={() => (controles ? setControles(false) : mostrarControles())}
        onDoubleClick={(evento) => {
          const meio = evento.currentTarget.clientWidth / 2;
          pular(evento.nativeEvent.offsetX > meio ? 10 : -10);
        }}
        className="absolute inset-0 cursor-default"
      />

      {bufferando && estado.nome === "pronto" ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-2 border-white/25 border-t-white"
        />
      ) : null}

      {/* Aviso de retomada ------------------------------------------------ */}
      <AnimatePresence>
        {avisoRetomada && estado.nome === "pronto" ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 flex justify-center"
            style={{ top: "calc(var(--safe-t) + 4.5rem)" }}
            onAnimationComplete={() => {
              window.setTimeout(() => setAvisoRetomada(false), 3000);
            }}
          >
            <span className="rounded-full bg-black/65 px-3.5 py-2 text-[0.8125rem] font-medium text-white backdrop-blur-sm">
              Retomando de {formatClock(retomarEm)}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Controles -------------------------------------------------------- */}
      <AnimatePresence>
        {controles ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="pointer-events-none absolute inset-0"
          >
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/75 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/85 to-transparent" />

            <div
              className="pointer-events-auto absolute inset-x-0 top-0 flex items-start gap-3 px-4 py-3"
              style={{ paddingTop: "calc(var(--safe-t) + 0.75rem)" }}
            >
              <button
                type="button"
                onClick={voltarDoEpisodio}
                aria-label="Voltar"
                className="tap grid size-10 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
              >
                <IconeVoltar tamanho={20} />
              </button>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-gold-400">
                  T{episodio.temporada} · Episódio {episodio.numero}
                </p>
                <p className="truncate font-display text-[1.0625rem] font-semibold leading-tight text-white">
                  {episodio.titulo}
                </p>
                <Link
                  href={`/novela/${episodio.novela.slug}`}
                  className="truncate text-[0.75rem] text-white/65"
                >
                  {episodio.novela.titulo}
                </Link>
              </div>
              <button
                type="button"
                onClick={() => setMudo((v) => !v)}
                aria-label={mudo ? "Ativar som" : "Silenciar"}
                className="tap grid size-10 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
              >
                <IconeVolume tamanho={19} mudo={mudo} />
              </button>
              <button
                type="button"
                onClick={emTelaCheia ? sairTelaCheia : entrarTelaCheia}
                aria-label={
                  emTelaCheia ? "Sair da tela cheia" : "Abrir em tela cheia"
                }
                aria-pressed={emTelaCheia}
                className="tap grid size-10 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
              >
                <IconeTelaCheia tamanho={19} ativa={emTelaCheia} />
              </button>
            </div>

            <div className="pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-7">
              <button
                type="button"
                onClick={() => pular(-10)}
                aria-label="Voltar 10 segundos"
                className="tap text-[0.8125rem] font-bold text-white/85"
              >
                −10s
              </button>
              <button
                type="button"
                onClick={alternarPlay}
                aria-label={tocando ? "Pausar" : "Tocar"}
                className="tap grid size-16 place-items-center rounded-full bg-white/95 text-ink-950 shadow-lift"
              >
                {tocando ? (
                  <IconePausa tamanho={26} />
                ) : (
                  <IconePlay tamanho={26} className="ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => pular(10)}
                aria-label="Avançar 10 segundos"
                className="tap text-[0.8125rem] font-bold text-white/85"
              >
                +10s
              </button>
            </div>

            <div
              className="pointer-events-auto absolute inset-x-0 bottom-0 px-5 pb-5"
              style={{ paddingBottom: "calc(var(--safe-b) + 1.25rem)" }}
            >
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(duracao))}
                value={Math.round(posicao)}
                aria-label="Posição no episódio"
                onChange={(evento) => {
                  const valor = Number(evento.target.value);
                  setPosicao(valor);
                  if (videoRef.current) videoRef.current.currentTime = valor;
                  mostrarControles();
                }}
                className="w-full accent-rose-500"
                style={{
                  background: `linear-gradient(to right, ${episodio.novela.accent} ${progresso}%, rgb(255 255 255 / 0.25) ${progresso}%)`,
                  height: "0.25rem",
                  borderRadius: "999px",
                  appearance: "none",
                }}
              />
              <div className="mt-2 flex items-center justify-between text-[0.75rem] font-medium text-white/75">
                <span>{formatClock(posicao)}</span>
                <div className="flex items-center gap-3">
                  {proximo ? (
                    <Link
                      href={`/assistir/${proximo.id}`}
                      className="tap flex items-center gap-1.5 font-semibold text-white"
                    >
                      <IconeProximo tamanho={16} />
                      Próximo
                    </Link>
                  ) : null}
                  <span>{formatClock(duracao)}</span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Fim do episódio -------------------------------------------------- */}
      <AnimatePresence>
        {contagem !== null && proximo ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 grid place-items-center bg-ink-950/92 px-7 text-center backdrop-blur-sm"
          >
            <div>
              <p className="eyebrow">A seguir</p>
              <div
                className="mx-auto mt-4 w-44 overflow-hidden rounded-card border border-white/10"
                style={{ aspectRatio: "16 / 9" }}
              >
                <img src={proximo.capaUrl} alt="" className="size-full object-cover" />
              </div>
              <h2 className="mt-4 text-[1.375rem] leading-tight">
                {proximo.titulo}
              </h2>
              <p className="mt-1 text-[0.8125rem] text-cream-400">
                T{proximo.temporada} · Episódio {proximo.numero}
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <Link
                  href={`/assistir/${proximo.id}`}
                  className="tap flex h-13 items-center justify-center gap-2 rounded-2xl bg-cream-50 text-[0.9375rem] font-bold text-ink-950"
                >
                  <IconePlay tamanho={16} />
                  Assistir agora ({contagem})
                </Link>
                <button
                  type="button"
                  onClick={() => setContagem(null)}
                  className="tap flex h-13 items-center justify-center rounded-2xl border border-white/14 bg-white/6 text-[0.9375rem] font-semibold text-cream-200"
                >
                  Ficar aqui
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TelaMensagem({
  episodio,
  titulo,
  texto,
  acao,
  icone,
}: {
  episodio: EpisodioPlayer;
  titulo: string;
  texto: string;
  acao: React.ReactNode;
  icone?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-ink-950">
      <img
        src={episodio.capaUrl}
        alt=""
        className="absolute inset-0 size-full object-cover opacity-25 blur-xl"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/85 to-ink-950/60" />

      <div
        className="relative flex h-full flex-col items-center justify-center px-8 text-center"
        style={{ paddingBottom: "calc(var(--safe-b) + 2rem)" }}
      >
        {icone ? (
          <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-gold-400/15 text-gold-400">
            {icone}
          </span>
        ) : null}
        <p className="eyebrow">
          T{episodio.temporada} · Episódio {episodio.numero}
        </p>
        <h1 className="mt-2 text-[1.625rem] leading-tight text-balance-pt">
          {titulo}
        </h1>
        <p className="selectable mt-2.5 max-w-[22rem] text-[0.9375rem] leading-relaxed text-cream-400">
          {texto}
        </p>
        <div className="mt-7 flex flex-col items-stretch gap-2.5">
          {acao}
          <Link
            href={`/novela/${episodio.novela.slug}`}
            className="tap flex h-13 items-center justify-center rounded-2xl border border-white/14 bg-white/6 px-7 text-[0.9375rem] font-semibold text-cream-200"
          >
            Voltar para a novela
          </Link>
        </div>
      </div>
    </div>
  );
}
