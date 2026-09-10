"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Núcleo de reprodução compartilhado entre o player de tela cheia
 * (`components/player/Player.tsx`) e as lâminas do reel
 * (`components/reel/Lamina.tsx`).
 *
 * Este arquivo existe porque as duas superfícies são visualmente opostas —
 * uma tem barra de busca e tela cheia, a outra não tem controle nenhum — mas
 * dependem exatamente da mesma contabilidade invisível: tempo real de tela,
 * envio por `sendBeacon` quando a aba morre, wake lock e renovação de URL
 * assinada. Reimplementar isso na tela nova regrediria o painel em silêncio,
 * e o bug só apareceria semanas depois, num gráfico de "tempo assistido" que
 * ninguém consegue explicar.
 */

export type Fonte = {
  kind: "mp4" | "hls";
  url: string;
  poster: string | null;
  expiresAt?: string | null;
};

// ------------------------------------------------------------ wake lock

type SentinelaTela = { release: () => Promise<void>; released: boolean };

type NavegadorComWakeLock = Navigator & {
  wakeLock?: { request: (tipo: "screen") => Promise<SentinelaTela> };
};

/**
 * Mantém a tela acesa enquanto algo está tocando.
 *
 * Solta a sentinela sozinho quando a aba vai para segundo plano: o navegador
 * revoga o lock nesse momento de qualquer forma, e uma sentinela revogada
 * guardada num ref impediria o próximo pedido de valer.
 */
export function useTelaAcordada() {
  const sentinelaRef = useRef<SentinelaTela | null>(null);
  const tocandoRef = useRef(false);

  const liberar = useCallback(() => {
    tocandoRef.current = false;
    const sentinela = sentinelaRef.current;
    sentinelaRef.current = null;
    if (sentinela && !sentinela.released) void sentinela.release().catch(() => {});
  }, []);

  const manter = useCallback(() => {
    tocandoRef.current = true;
    const navegador = navigator as NavegadorComWakeLock;
    if (sentinelaRef.current?.released) sentinelaRef.current = null;
    if (!navegador.wakeLock || sentinelaRef.current || document.hidden) return;
    void navegador.wakeLock
      .request("screen")
      .then((sentinela) => {
        // Entre pedir e receber, a pessoa pode ter pausado. Guardar uma
        // sentinela órfã manteria a tela acesa com o vídeo parado.
        if (!tocandoRef.current) void sentinela.release().catch(() => {});
        else sentinelaRef.current = sentinela;
      })
      .catch(() => {
        // Economia de bateria ou política do aparelho pode negar. Silencioso
        // de propósito: é conforto, não funcionalidade.
      });
  }, []);

  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (document.hidden) {
        const sentinela = sentinelaRef.current;
        sentinelaRef.current = null;
        if (sentinela && !sentinela.released) void sentinela.release().catch(() => {});
      } else if (tocandoRef.current) {
        manter();
      }
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      liberar();
    };
  }, [liberar, manter]);

  return { manterTelaAcordada: manter, liberarTelaAcordada: liberar };
}

// ------------------------------------------------------------- progresso

const INTERVALO_SALVAR_MS = 10_000;
/** Teto por tique: uma aba em segundo plano não deve acumular horas fantasma. */
const TETO_POR_TIQUE_MS = 2000;

export type OpcoesDeEnvio = {
  completo?: boolean;
  abandonado?: boolean;
  beacon?: boolean;
};

/**
 * Contabiliza e envia progresso de um episódio.
 *
 * Duas decisões carregam peso:
 *
 * 1. O que sobe é **tempo real de tela acumulado** (`deltaMs`), não a posição
 *    pura. Quem arrasta a barra até o fim não assistiu ao episódio, e o painel
 *    precisa saber a diferença.
 *
 * 2. `deveGravar` é consultado no momento do envio, não na montagem. No reel a
 *    pessoa atravessa dezenas de lâminas por minuto; gravar `WatchProgress`
 *    para cada uma encheria "Continue assistindo" de episódios que ninguém
 *    viu — e o produto exige que todo número seja reconstruível a partir de um
 *    fato real.
 */
export function useRegistroDeProgresso({
  videoRef,
  episodeId,
  duracaoPadraoSec,
  sessionId,
  deveGravar,
  ativo = true,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  episodeId: string;
  duracaoPadraoSec: number;
  sessionId: () => string | null;
  deveGravar: () => boolean;
  ativo?: boolean;
}) {
  const assistidoMsRef = useRef(0);
  const ultimoTiqueRef = useRef(0);
  const salvoAteRef = useRef(0);

  // O envio roda dentro de limpeza de efeito e de ouvintes de janela. Guardar
  // as dependências num ref mantém a função estável — do contrário cada quadro
  // de vídeo remontaria os ouvintes de `pagehide`.
  const contextoRef = useRef({ episodeId, duracaoPadraoSec, sessionId, deveGravar });
  contextoRef.current = { episodeId, duracaoPadraoSec, sessionId, deveGravar };

  const enviar = useCallback(
    (opcoes: OpcoesDeEnvio = {}) => {
      const ctx = contextoRef.current;
      if (!ctx.deveGravar()) {
        // Descarta o acumulado: ele pertence a uma passagem que não conta.
        assistidoMsRef.current = 0;
        return;
      }

      const video = videoRef.current;
      const posicao = video?.currentTime ?? 0;
      const duracao =
        video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : ctx.duracaoPadraoSec;

      const deltaMs = Math.round(assistidoMsRef.current);
      if (
        deltaMs === 0 &&
        !opcoes.completo &&
        Math.abs(posicao - salvoAteRef.current) < 1
      ) {
        return;
      }
      assistidoMsRef.current = 0;
      salvoAteRef.current = posicao;

      const corpo = JSON.stringify({
        episodeId: ctx.episodeId,
        positionSec: posicao,
        durationSec: duracao,
        deltaMs,
        completed: opcoes.completo,
        abandoned: opcoes.abandonado,
        sessionId: ctx.sessionId(),
      });

      if (opcoes.beacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/progresso",
          new Blob([corpo], { type: "application/json" }),
        );
        return;
      }
      void fetch("/api/progresso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: corpo,
        keepalive: true,
      }).catch(() => {});
    },
    [videoRef],
  );

  /** Chamar em `onTimeUpdate`. Acumula só o tempo em que o vídeo andou. */
  const aoAtualizarTempo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const agora = performance.now();
    if (!video.paused && ultimoTiqueRef.current > 0) {
      assistidoMsRef.current += Math.min(
        agora - ultimoTiqueRef.current,
        TETO_POR_TIQUE_MS,
      );
    }
    ultimoTiqueRef.current = agora;
  }, [videoRef]);

  /** Chamar quando o vídeo volta a andar, para reabrir a janela de contagem. */
  const marcarInicioDeContagem = useCallback(() => {
    ultimoTiqueRef.current = performance.now();
  }, []);

  /** Chamar ao pausar: sem isso, a pausa contaria como tela assistida. */
  const pararContagem = useCallback(() => {
    ultimoTiqueRef.current = 0;
  }, []);

  useEffect(() => {
    if (!ativo) return;

    const salvar = window.setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) enviar();
    }, INTERVALO_SALVAR_MS);

    const aoSair = () => enviar({ abandonado: true, beacon: true });
    const aoEsconder = () => {
      if (document.visibilityState === "hidden") aoSair();
    };
    window.addEventListener("pagehide", aoSair);
    document.addEventListener("visibilitychange", aoEsconder);

    return () => {
      window.clearInterval(salvar);
      window.removeEventListener("pagehide", aoSair);
      document.removeEventListener("visibilitychange", aoEsconder);
      enviar({ abandonado: true });
    };
  }, [ativo, enviar, videoRef]);

  return { enviar, aoAtualizarTempo, marcarInicioDeContagem, pararContagem };
}

// ------------------------------------------------------- fonte assinada

export type ResultadoRenovacao =
  | { estado: "pronto"; fonte: Fonte }
  | { estado: "bloqueado"; motivo: string }
  | { estado: "falhou" };

/**
 * Pede uma fonte nova à rota de mídia.
 *
 * O caminho normal já recebe a fonte assinada junto com o HTML — isto aqui só
 * entra quando a URL vence no meio da exibição. É por isso que um erro de
 * vídeo tenta renovar antes de virar tela de erro: na maioria das vezes o
 * arquivo está lá, só a assinatura envelheceu.
 */
export async function renovarFonte(episodeId: string): Promise<ResultadoRenovacao> {
  try {
    const resposta = await fetch(`/api/midia/${episodeId}`);
    const dados = await resposta.json().catch(() => null);
    if (resposta.ok && dados?.fonte) {
      return { estado: "pronto", fonte: dados.fonte as Fonte };
    }
    if (resposta.status === 401 || resposta.status === 402) {
      return { estado: "bloqueado", motivo: dados?.motivo ?? "precisa-pagar" };
    }
  } catch {
    /* tratado por quem chamou */
  }
  return { estado: "falhou" };
}
