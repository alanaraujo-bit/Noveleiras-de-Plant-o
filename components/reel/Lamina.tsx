"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { AcoesLaterais } from "@/components/reel/AcoesLaterais";
import {
  IconeCadeado,
  IconeCoracaoCheio,
  IconePlay,
  IconeVolume,
} from "@/components/ui/icones";
import {
  renovarFonte,
  useRegistroDeProgresso,
  useTelaAcordada,
  type Fonte,
} from "@/lib/player/reproducao";
import type { LaminaReel } from "@/lib/repositories/reel";

/**
 * Uma lâmina do reel: um episódio ocupando a tela inteira.
 *
 * O que faz esta tela parecer viva não é o vídeo — é a ausência de espera. Por
 * isso a lâmina nunca busca nada antes do primeiro quadro: a fonte já chega
 * assinada do servidor, e o vizinho de baixo já está decodificado quando o
 * dedo encosta na tela.
 *
 * Três estados são de primeira classe, como no player de tela cheia: tocando,
 * bloqueada e com erro. Nenhum deles é tratado como exceção, porque no reel
 * uma lâmina em branco não é um erro isolado — é a fila inteira parecendo
 * quebrada.
 */

type Props = {
  lamina: LaminaReel;
  /** Posicao na fila. Vai para o DOM: e por ele que o observador identifica quem entrou em cena. */
  indice: number;
  /** A lâmina está centralizada na tela. Só uma por vez toca. */
  ativa: boolean;
  /** Está na janela de montagem (anterior, atual ou próxima). */
  montada: boolean;
  /** Um painel está de pé sobre a lâmina: o cromo sai de cena. */
  recuada: boolean;
  somLigado: boolean;
  economiaDeDados: boolean;
  /** Verdadeiro depois do limiar de permanência — libera gravação e contagem. */
  contabilizavel: boolean;
  sessionId: () => string | null;
  aoBarrarSom: () => void;
  aoAlternarSom: () => void;
  aoTerminar: () => void;
  aoCurtir: () => void;
  aoAbrirComentarios: () => void;
  aoEnviar: () => void;
};

export function Lamina({
  lamina,
  indice,
  ativa,
  montada,
  recuada,
  somLigado,
  economiaDeDados,
  contabilizavel,
  sessionId,
  aoBarrarSom,
  aoAlternarSom,
  aoTerminar,
  aoCurtir,
  aoAbrirComentarios,
  aoEnviar,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fonte, setFonte] = useState<Fonte | null>(lamina.fonte);
  const [falhou, setFalhou] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [pausadaPelaPessoa, setPausadaPelaPessoa] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [sinopseAberta, setSinopseAberta] = useState(false);
  const [estouroDeCoracao, setEstouroDeCoracao] = useState(0);

  const { manterTelaAcordada, liberarTelaAcordada } = useTelaAcordada();

  // Trava de mão única.
  //
  // `contabilizavel` cai para falso no mesmo commit em que a lâmina sai de
  // cena — e é justamente nesse commit que o envio final acontece. Ler a
  // propriedade crua descartaria o último trecho assistido e a posição final
  // de todo episódio visto pelo reel: o ponto de retomada ficaria até dez
  // segundos atrasado, sempre. Uma vez cruzado o limiar, esta lâmina continua
  // gravável até o fim da própria vida.
  const gravavelRef = useRef(false);
  if (contabilizavel) gravavelRef.current = true;

  // Um episódio novo na mesma posição da fila recomeça a contagem do zero.
  useEffect(() => {
    gravavelRef.current = false;
  }, [lamina.episodio.id]);

  const { enviar, aoAtualizarTempo, marcarInicioDeContagem, pararContagem } =
    useRegistroDeProgresso({
      videoRef,
      episodeId: lamina.episodio.id,
      duracaoPadraoSec: lamina.episodio.duracaoSec,
      sessionId,
      // A gravação só é liberada depois que a pessoa ficou. Sem esta porta,
      // uma passada de dedo por dez lâminas criaria dez linhas de progresso e
      // "Continue assistindo" viraria a lista de tudo que ela não viu.
      deveGravar: () => gravavelRef.current,
      ativo: montada,
    });

  // -------------------------------------------------------------- retomada
  //
  // Não pode depender só de `loadedmetadata`: o vizinho de baixo é montado
  // antes de entrar em cena e pode ter os metadados em cache, engolindo o
  // evento e reiniciando o episódio do zero na hora do swipe.
  const retomadaAplicadaRef = useRef(false);

  /**
   * Onde recolocar a agulha depois que o elemento de vídeo é remontado.
   *
   * Renovar uma URL assinada troca o `src`, e trocar o `src` remonta o vídeo do
   * zero. Sem guardar o instante, um episódio que vence a assinatura aos vinte
   * minutos voltaria ao começo — e a retomada normal não salvaria, porque ela
   * já foi aplicada uma vez e não se repete.
   */
  const retomarAposTrocaRef = useRef<number | null>(null);

  const posicionar = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const apos = retomarAposTrocaRef.current;
    if (apos !== null) {
      retomarAposTrocaRef.current = null;
      if (Number.isFinite(video.duration) && apos < video.duration - 1) {
        video.currentTime = apos;
        return;
      }
    }

    if (
      !retomadaAplicadaRef.current &&
      lamina.retomarEm > 0 &&
      Number.isFinite(video.duration) &&
      lamina.retomarEm < video.duration - 2
    ) {
      retomadaAplicadaRef.current = true;
      video.currentTime = lamina.retomarEm;
    }
  }, [lamina.retomarEm]);

  /** Pede uma fonte nova guardando onde a agulha estava. */
  const trocarFonte = useCallback(() => {
    retomarAposTrocaRef.current = videoRef.current?.currentTime ?? null;
    void renovarFonte(lamina.episodio.id).then((resultado) => {
      if (resultado.estado === "pronto") {
        setFalhou(false);
        setFonte(resultado.fonte);
      } else {
        retomarAposTrocaRef.current = null;
        setFalhou(true);
      }
    });
  }, [lamina.episodio.id]);

  useEffect(() => {
    retomadaAplicadaRef.current = false;
    const video = videoRef.current;
    if (video && video.readyState >= 1) posicionar();
  }, [lamina.episodio.id, posicionar]);

  // ------------------------------------------------------------- tocar
  //
  // O reel tenta abrir com som, porque um folhetim mudo não prende ninguém.
  // Quando o navegador recusa — e recusa na primeira visita, sempre — a lâmina
  // cai para mudo, continua tocando e avisa o pai, que exibe a pílula de som.
  // O contrário (abrir mudo por precaução) transformaria toda primeira sessão
  // numa experiência sem áudio.
  const tentarTocar = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !fonte) return;

    video.muted = !somLigado;
    try {
      await video.play();
      return;
    } catch {
      /* tentativa com som barrada */
    }

    if (!video.muted) {
      video.muted = true;
      aoBarrarSom();
      try {
        await video.play();
        return;
      } catch {
        /* nem mudo: cai no botão de play */
      }
    }
    setTocando(false);
  }, [aoBarrarSom, fonte, somLigado]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (ativa && !pausadaPelaPessoa) {
      void tentarTocar();
      return;
    }

    video.pause();
    if (!ativa) {
      // Sair de cena zera a pausa manual: quem volta a esta lâmina depois
      // espera que ela volte a tocar, não que continue parada por um toque
      // dado há dez lâminas.
      setPausadaPelaPessoa(false);
      enviar({ abandonado: true });
    }
  }, [ativa, enviar, pausadaPelaPessoa, tentarTocar]);

  // Trocar o som com a lâmina já tocando não deve reiniciar nada.
  useEffect(() => {
    const video = videoRef.current;
    if (video && ativa) video.muted = !somLigado;
  }, [ativa, somLigado]);

  const alternarPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !fonte) return;
    if (video.paused) {
      setPausadaPelaPessoa(false);
      void tentarTocar();
    } else {
      setPausadaPelaPessoa(true);
      video.pause();
    }
  }, [fonte, tentarTocar]);

  // ------------------------------------------------------- toque na tela
  //
  // Um toque pausa, dois curtem. Distinguir os dois exige uma espera curta, e
  // é por isso que o adiamento existe: sem ele, o primeiro toque de um toque
  // duplo pausaria o vídeo no meio do coração.
  const toqueRef = useRef<{ ultimo: number; timer: number | null }>({
    ultimo: 0,
    timer: null,
  });

  const aoTocarNaTela = useCallback(() => {
    const agora = Date.now();
    const estado = toqueRef.current;

    if (agora - estado.ultimo < 280) {
      if (estado.timer) window.clearTimeout(estado.timer);
      estado.timer = null;
      estado.ultimo = 0;
      setEstouroDeCoracao((n) => n + 1);
      // Toque duplo só curte, nunca descurte: quem bate duas vezes está
      // aplaudindo. Tirar a curtida exige o botão, que é explícito.
      if (!lamina.social.curtido) aoCurtir();
      return;
    }

    estado.ultimo = agora;
    estado.timer = window.setTimeout(() => {
      estado.timer = null;
      alternarPlay();
    }, 280);
  }, [alternarPlay, aoCurtir, lamina.social.curtido]);

  useEffect(
    () => () => {
      if (toqueRef.current.timer) window.clearTimeout(toqueRef.current.timer);
    },
    [],
  );

  // ------------------------------------------------------------- render

  const bloqueada = lamina.bloqueio !== null;
  const podeMostrarVideo = montada && fonte !== null && !falhou;

  return (
    <section
      data-indice={indice}
      className="lamina-snap relative w-full shrink-0 overflow-hidden bg-black"
      style={{ height: "var(--reel-h)" }}
      aria-label={`${lamina.novela.titulo}, episódio ${lamina.episodio.numero}`}
    >
      {/* Cartaz: fica sempre atrás do vídeo. É o que a pessoa vê no instante
          entre o swipe e o primeiro quadro, e é o que sobra quando a lâmina
          está bloqueada ou o arquivo falhou. */}
      <img
        src={lamina.episodio.capaUrl}
        alt=""
        draggable={false}
        className={`absolute inset-0 size-full object-cover ${
          bloqueada ? "scale-105 blur-2xl brightness-[0.45]" : ""
        }`}
      />

      {podeMostrarVideo ? (
        <video
          ref={videoRef}
          key={fonte.url}
          src={fonte.url}
          poster={lamina.episodio.capaUrl}
          playsInline
          loop={false}
          muted={!somLigado}
          // A lâmina em cena carrega de verdade; as vizinhas só buscam
          // metadados, para o swipe começar sem espera. Em economia de dados
          // nem isso: quem pediu para economizar não quer três vídeos na fila.
          preload={ativa ? "auto" : economiaDeDados ? "none" : "metadata"}
          className="absolute inset-0 size-full object-cover"
          onLoadedMetadata={posicionar}
          onTimeUpdate={() => {
            aoAtualizarTempo();
            const video = videoRef.current;
            if (!video) return;
            const total =
              Number.isFinite(video.duration) && video.duration > 0
                ? video.duration
                : lamina.episodio.duracaoSec;
            setProgresso(total > 0 ? (video.currentTime / total) * 100 : 0);
          }}
          onPlaying={() => {
            setTocando(true);
            marcarInicioDeContagem();
            manterTelaAcordada();
          }}
          onPause={() => {
            setTocando(false);
            pararContagem();
            liberarTelaAcordada();
            enviar();
          }}
          onEnded={() => {
            setTocando(false);
            liberarTelaAcordada();
            enviar({ completo: true });
            aoTerminar();
          }}
          onError={() => {
            // Quase sempre é só a assinatura vencida — o arquivo está lá.
            // Desistir antes de tentar renovar transformaria uma URL velha
            // numa lâmina permanentemente quebrada.
            trocarFonte();
          }}
        />
      ) : null}

      {/* Camada de toque. Fica sob os controles laterais e sob o texto, para
          que tocar num link não pause o vídeo por acidente. */}
      {!bloqueada && !falhou ? (
        <button
          type="button"
          aria-label={tocando ? "Pausar" : "Tocar"}
          onClick={aoTocarNaTela}
          className="absolute inset-0 z-10 cursor-default"
        />
      ) : null}

      {/* Coração do toque duplo */}
      {estouroDeCoracao > 0 ? (
        <span
          key={estouroDeCoracao}
          aria-hidden
          className="coracao-estouro pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-rose-500 drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
        >
          <IconeCoracaoCheio tamanho={104} />
        </span>
      ) : null}

      {/* Pausa: um sinal discreto, não um painel de controle. */}
      <AnimatePresence>
        {ativa && !tocando && !bloqueada && !falhou && fonte ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.18 }}
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-20 grid size-[4.5rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white/95 backdrop-blur-[2px]"
          >
            <IconePlay tamanho={30} className="ml-1" />
          </motion.span>
        ) : null}
      </AnimatePresence>

      <div className="veu-superior pointer-events-none absolute inset-x-0 top-0 z-10 h-32" />
      <div className="veu-inferior pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64" />

      {/* Pílula de som: aparece só enquanto o áudio está desligado. */}
      <AnimatePresence>
        {ativa && !somLigado && !bloqueada ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onClick={aoAlternarSom}
            className="tap absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-3.5 py-2 text-[0.8125rem] font-semibold text-white backdrop-blur-md"
            style={{ top: "calc(var(--safe-t) + 3.25rem)" }}
          >
            <IconeVolume tamanho={16} mudo />
            Toque para ouvir
          </motion.button>
        ) : null}
      </AnimatePresence>

      {/* ------------------------------------------------------ bloqueio */}
      {bloqueada ? (
        <div className="absolute inset-0 z-20 grid place-items-center px-9 text-center">
          <div>
            <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gold-400/15 text-gold-400">
              <IconeCadeado tamanho={26} />
            </span>
            <p className="eyebrow">
              T{lamina.episodio.temporada} · Episódio {lamina.episodio.numero}
            </p>
            <h2 className="mt-2 text-[1.5rem] leading-tight text-balance-pt text-white">
              {lamina.bloqueio === "precisa-conta"
                ? "Entre para continuar"
                : "A história continua no catálogo pago"}
            </h2>
            <p className="mx-auto mt-2.5 max-w-[20rem] text-[0.9375rem] leading-relaxed text-cream-400">
              {lamina.bloqueio === "precisa-conta"
                ? "Sua conta guarda o progresso e libera os episódios."
                : "Assine tudo, ou compre só esta novela e ela é sua para sempre."}
            </p>
            <Link
              href={
                lamina.bloqueio === "precisa-conta"
                  ? "/entrar"
                  : `/novela/${lamina.novela.slug}#desbloquear`
              }
              className="tap mt-6 inline-flex h-13 items-center justify-center rounded-2xl bg-gold-400 px-7 text-[0.9375rem] font-bold text-ink-950"
            >
              {lamina.bloqueio === "precisa-conta"
                ? "Entrar"
                : "Ver como desbloquear"}
            </Link>
            <p className="mt-4 text-[0.75rem] text-cream-600">
              Continue deslizando para ver outras novelas.
            </p>
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- erro */}
      {falhou && !bloqueada ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 px-9 text-center">
          <div>
            <h2 className="text-[1.25rem] leading-tight text-white">
              Este episódio não respondeu
            </h2>
            <p className="mt-2 text-[0.875rem] text-cream-400">
              Deslize para o próximo — voltamos a tentar depois.
            </p>
            <button
              type="button"
              onClick={trocarFonte}
              className="tap mt-5 inline-flex h-11 items-center rounded-full border border-white/16 bg-white/8 px-5 text-[0.875rem] font-semibold text-cream-100"
            >
              Tentar de novo
            </button>
          </div>
        </div>
      ) : null}

      {/* Cromo da lâmina.

          Some junto, num plano só, quando um painel sobe: a faixa de vídeo que
          sobra acima dele é estreita, e manter a coluna de ações e o texto ali
          empilharia dois níveis de interface disputando poucos pixels. */}
      {/* O invólucro é transparente ao toque e os filhos reativam o alvo. Sem
          isso, uma camada de tela inteira cobriria a área de tocar/pausar, que
          vive logo abaixo — e o vídeo pararia de responder ao toque. */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-200 ${
          recuada ? "opacity-0" : "opacity-100"
        }`}
      >
        <AcoesLaterais
          lamina={lamina}
          aoCurtir={aoCurtir}
          aoAbrirComentarios={aoAbrirComentarios}
          aoEnviar={aoEnviar}
        />

        {/* ---------------------------------------------------- identidade */}
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 px-4 pr-[4.75rem]"
          style={{
            paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 0.875rem)",
          }}
        >
        <div className="flex items-center gap-2">
          <Link
            href={`/novela/${lamina.novela.slug}`}
            className="min-w-0 truncate font-display text-[1.0625rem] font-semibold leading-tight text-white"
          >
            {lamina.novela.titulo}
          </Link>
          <span
            className="size-1 shrink-0 rounded-full bg-white/40"
            aria-hidden
          />
          {/* Fatia contextual: no reel, saber onde se está na novela é o que
              separa "um vídeo aleatório" de "o capítulo de ontem". */}
          <span className="shrink-0 text-[0.75rem] font-semibold tabular-nums text-white/70">
            {lamina.origem === "gancho"
              ? `${lamina.episodio.total} episódios`
              : `Ep ${lamina.episodio.posicao} de ${lamina.episodio.total}`}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setSinopseAberta((v) => !v)}
          aria-expanded={sinopseAberta}
          className="mt-1.5 block w-full text-left"
        >
          {/* Sem `block` junto de `line-clamp-2`: as duas utilidades escrevem
              `display`, e a última na folha de estilo vence. Com `block` no
              caminho, a sinopse da novela abria em nove linhas e cobria a cena
              inteira — o oposto de uma lâmina. */}
          {/* Aberta, a sinopse ganha teto e rolagem própria: algumas passam de
              dez linhas, e sem teto elas subiriam além do véu de leitura, com
              texto branco caindo direto sobre a cena clara. `overscroll-contain`
              impede que rolar a sinopse até o fim vire um swipe de lâmina. */}
          <span
            className={`text-[0.875rem] leading-snug text-white/85 ${
              sinopseAberta
                ? "block max-h-[40dvh] overflow-y-auto overscroll-contain pr-1"
                : "line-clamp-2"
            }`}
          >
            {lamina.episodio.gancho}
          </span>
          {!sinopseAberta && lamina.episodio.gancho.length > 90 ? (
            <span className="mt-0.5 inline-block text-[0.75rem] font-semibold text-white/55">
              mais
            </span>
          ) : null}
        </button>

        {lamina.novela.tags.length > 0 ? (
          <p className="mt-2 truncate text-[0.75rem] font-medium text-white/50">
            {lamina.novela.tags.map((tag) => `#${tag}`).join("  ")}
          </p>
        ) : null}
      </div>

        {/* Linha de progresso: fina, sem alça, encostada na barra de abas. Um
            reel não tem barra de busca — arrastar aqui competiria com o swipe. */}
        <div
          className="absolute inset-x-0 h-[2px] bg-white/12"
          style={{ bottom: "calc(var(--tabbar-h) + var(--safe-b))" }}
        >
          <div
            className="h-full origin-left transition-[width] duration-200 ease-linear"
            style={{
              width: `${Math.min(100, Math.max(0, progresso))}%`,
              background: lamina.novela.accent,
            }}
          />
        </div>
      </div>
    </section>
  );
}
