"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";

import { AcoesLaterais } from "@/components/reel/AcoesLaterais";
import { BarraDeProgresso } from "@/components/reel/BarraDeProgresso";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import {
  IconeCadeado,
  IconeCoracaoCheio,
  IconePlay,
  IconeSeta,
  IconeVolume,
} from "@/components/ui/icones";
import {
  caixaDoVideo,
  enquadramento,
  type LayoutDaConversa,
} from "@/lib/player/enquadramento";
import { useGestosDoReel } from "@/lib/player/gestos";
import { foiBloqueioDeAutoplay } from "@/lib/player/estado-reel";
import {
  renovarFonte,
  useRegistroDeProgresso,
  useTelaAcordada,
  type Fonte,
} from "@/lib/player/reproducao";
import type { LaminaReel } from "@/lib/repositories/reel";
import { lerProgressoVisitante } from "@/lib/player/visitante";

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

/**
 * Tempo assistindo sem tocar em nada antes da interface sair de cena.
 *
 * Quatro segundos e meio: curto o bastante para a tela limpar durante uma cena
 * comum, longo o bastante para não apagar os botões no meio de uma decisão.
 */
const ESPERA_PARA_IMERGIR_MS = 4500;

/** Mesma mola do painel: vídeo e conversa se reajustam no mesmo ritmo. */
const MOLA_DE_REAJUSTE = { type: "spring", stiffness: 320, damping: 36 } as const;

type Props = {
  visitante?: boolean;
  aoPedirConta?: () => void;
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
  /**
   * Quanto a conversa está aberta, de 0 a 1.
   *
   * Um valor só, compartilhado pelo painel e por todas as lâminas montadas, e
   * lido direto pelo motion — sem passar pelo React a cada quadro. É isso que
   * põe vídeo e painel no mesmo movimento, inclusive enquanto o dedo arrasta.
   */
  abertura: MotionValue<number>;
  /** Tamanho da tela travada pelo reel. Nulo antes da primeira medida. */
  tela: { largura: number; altura: number } | null;
  /** Geometria da conversa aberta; nula com ela fechada. */
  conversa: LayoutDaConversa | null;
  /** Arrasto vertical sobre o vídeo, só com a conversa aberta. */
  aoDeslizar?: (sentido: 1 | -1) => void;
  /** Movimento reduzido, do sistema ou das preferências do app. */
  reduzido: boolean;
};

export function Lamina({
  visitante = false,
  aoPedirConta,
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
  abertura,
  tela,
  conversa,
  aoDeslizar,
  reduzido,
}: Props) {
  const { track } = useTelemetry();
  const videoRef = useRef<HTMLVideoElement>(null);
  const ativaRef = useRef(ativa);
  ativaRef.current = ativa;
  const [fonte, setFonte] = useState<Fonte | null>(lamina.fonte);
  const [falhou, setFalhou] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [pausadaPelaPessoa, setPausadaPelaPessoa] = useState(false);
  // Posição e duração em segundos, não em porcentagem: a barra navegável
  // precisa converter um ponto da tela em um instante do episódio, e uma
  // porcentagem já perdeu a informação necessária para isso.
  const [posicaoSec, setPosicaoSec] = useState(lamina.retomarEm);
  const [duracaoSec, setDuracaoSec] = useState(lamina.episodio.duracaoSec);
  const [arrastandoBarra, setArrastandoBarra] = useState(false);
  const [sinopseAberta, setSinopseAberta] = useState(false);
  const [estouroDeCoracao, setEstouroDeCoracao] = useState(0);
  /**
   * Largura ÷ altura do conteúdo, lida dos metadados.
   *
   * Nula até eles chegarem — e, enquanto nula, tudo se comporta exatamente
   * como antes: caixa do tamanho da tela, `object-fit: cover`.
   */
  const [proporcao, setProporcao] = useState<number | null>(null);

  // ------------------------------------------------------------ imersão
  //
  // Depois de um tempo assistindo sem tocar em nada, a interface sai de cena e
  // fica só o episódio. É o gesto que o conteúdo pede: o texto e os botões
  // servem para decidir o que ver, e quem já decidiu não precisa mais deles.
  //
  // A regra que faz isso não irritar é uma só: **o primeiro toque depois da
  // imersão apenas traz a interface de volta, nunca pausa.** Sem ela, quem
  // quisesse ver as ações pausaria o episódio sem querer, toda vez.
  const [imersivo, setImersivo] = useState(false);
  const imersivoRef = useRef(false);
  imersivoRef.current = imersivo;
  const relogioDeImersaoRef = useRef<number | null>(null);

  const sairDaImersao = useCallback(() => {
    setImersivo(false);
  }, []);

  /** Reinicia a contagem. Toda interação passa por aqui. */
  const adiarImersao = useCallback(() => {
    if (relogioDeImersaoRef.current) {
      window.clearTimeout(relogioDeImersaoRef.current);
      relogioDeImersaoRef.current = null;
    }
    setImersivo(false);
  }, []);

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
      visitante,
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

    const local = lerProgressoVisitante();
    const retomarEm = local?.episodeId === lamina.episodio.id && !local.completed
      ? local.positionSec : lamina.retomarEm;
    if (
      !retomadaAplicadaRef.current &&
      retomarEm > 0 &&
      Number.isFinite(video.duration) &&
      retomarEm < video.duration - 2
    ) {
      retomadaAplicadaRef.current = true;
      video.currentTime = retomarEm;
    }
  }, [lamina.retomarEm, lamina.episodio.id]);

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
    } catch (erro) {
      // Sair da lamina enquanto play() esta pendente gera AbortError. Isso nao
      // e bloqueio de autoplay e nunca deve desligar o som das proximas cenas.
      if (!ativaRef.current || !foiBloqueioDeAutoplay(erro)) {
        if (ativaRef.current) setTocando(false);
        return;
      }
    }

    if (!video.muted && ativaRef.current) {
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

  // ------------------------------------------------ palco com a conversa
  //
  // O vídeo abre espaço para a conversa em vez de ser coberto por ela: encolhe
  // e sobe para a área livre, inteiro. O movimento é só `transform` num palco
  // em volta do `<video>` — o elemento de vídeo nunca muda, então nada
  // recarrega, nada volta ao começo e nada perde o que já estava baixado.
  //
  // O alvo (onde o palco termina com a conversa aberta) vive em valores de
  // movimento próprios, e a posição de cada quadro é alvo × abertura. Assim,
  // quando o teclado sobe e o alvo muda, o vídeo desliza até o novo lugar em
  // vez de pular — e o painel arrastado com o dedo arrasta o vídeo junto.
  const escalaAlvo = useMotionValue(1);
  const xAlvo = useMotionValue(0);
  const yAlvo = useMotionValue(0);
  const escala = useTransform(
    [abertura, escalaAlvo],
    ([a, e]: number[]) => 1 + (e - 1) * a,
  );
  const x = useTransform([abertura, xAlvo], ([a, v]: number[]) => v * a);
  const y = useTransform([abertura, yAlvo], ([a, v]: number[]) => v * a);

  // `useLayoutEffect`: o alvo precisa estar certo antes do primeiro quadro da
  // abertura. Com um efeito comum, o navegador poderia pintar um quadro com o
  // alvo antigo, e a animação começaria indo para o lugar errado.
  useLayoutEffect(() => {
    // Fechada, o alvo fica onde estava: é dele que a animação de volta parte.
    if (!conversa || !tela) return;
    const alvo = enquadramento(conversa, proporcao);
    // Animar o alvo só vale para a lâmina à vista — é o que faz o vídeo
    // deslizar quando o teclado sobe. As vizinhas estão fora da tela e
    // recebem o alvo de uma vez: quando entrarem em cena, já estão prontas.
    const deUmaVez = reduzido || abertura.get() < 0.001 || !ativa;
    const pares: Array<[MotionValue<number>, number]> = [
      [escalaAlvo, alvo.escala],
      [xAlvo, alvo.x],
      [yAlvo, alvo.y],
    ];
    for (const [valor, destino] of pares) {
      if (deUmaVez) valor.set(destino);
      else animate(valor, destino, MOLA_DE_REAJUSTE);
    }
  }, [abertura, ativa, conversa, escalaAlvo, proporcao, reduzido, tela, xAlvo, yAlvo]);

  /**
   * A caixa do vídeo no tamanho de "cobrir" a tela, na proporção do conteúdo.
   *
   * Em tela cheia é o mesmo recorte do `object-fit: cover`. Reduzida, mostra o
   * quadro inteiro — o rosto na borda e a legenda embaixo continuam lá.
   */
  const caixa =
    tela && proporcao ? caixaDoVideo(tela.largura, tela.altura, proporcao) : null;

  // ------------------------------------------------------- render

  const bloqueada = lamina.bloqueio !== null;
  const podeMostrarVideo = montada && fonte !== null && !falhou;

  // Proporção do conteúdo, lida de forma que não dependa de um evento só.
  //
  // O HTML do servidor já traz o `src`, então o navegador costuma carregar os
  // metadados **antes** de o React hidratar a lâmina — e o `onLoadedMetadata`
  // nunca vê o evento. Foi visto no navegador de verdade: o vídeo reduzido
  // saía com a proporção da tela, recortado, em vez do quadro inteiro. Aqui a
  // leitura acontece na montagem e em `resize`, o evento que o vídeo dispara
  // quando descobre (ou muda) as próprias dimensões.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ler = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setProporcao(video.videoWidth / video.videoHeight);
      }
    };
    ler();
    video.addEventListener("resize", ler);
    video.addEventListener("loadedmetadata", ler);
    return () => {
      video.removeEventListener("resize", ler);
      video.removeEventListener("loadedmetadata", ler);
    };
  }, [fonte?.url, podeMostrarVideo]);


  // O relógio da imersão só corre quando há o que assistir: lâmina em cena,
  // vídeo andando, nenhum painel aberto e nenhum arrasto em curso. Qualquer
  // uma dessas condições caindo devolve a interface — inclusive pausar, que é
  // o momento em que a pessoa mais precisa dos controles.
  useEffect(() => {
    const podeImergir =
      ativa && tocando && !recuada && !arrastandoBarra && !bloqueada && !falhou;

    if (!podeImergir) {
      if (relogioDeImersaoRef.current) {
        window.clearTimeout(relogioDeImersaoRef.current);
        relogioDeImersaoRef.current = null;
      }
      setImersivo(false);
      return;
    }

    if (imersivo) return;

    relogioDeImersaoRef.current = window.setTimeout(() => {
      relogioDeImersaoRef.current = null;
      setImersivo(true);
    }, ESPERA_PARA_IMERGIR_MS);

    return () => {
      if (relogioDeImersaoRef.current) {
        window.clearTimeout(relogioDeImersaoRef.current);
        relogioDeImersaoRef.current = null;
      }
    };
  }, [ativa, tocando, recuada, arrastandoBarra, bloqueada, falhou, imersivo]);

  // A barra de abas vive no layout do aplicativo, fora desta árvore. O sinal
  // vai pelo elemento raiz — o mesmo caminho que `data-superficie` já usa — e
  // o CSS decide o resto. Passar um callback por três níveis de componente só
  // para apagar uma barra seria acoplamento sem retorno.
  useEffect(() => {
    if (!ativa) return;
    const raiz = document.documentElement;
    if (imersivo) raiz.dataset.imersivo = "1";
    else delete raiz.dataset.imersivo;
    return () => {
      delete raiz.dataset.imersivo;
    };
  }, [ativa, imersivo]);

  // ------------------------------------------------------- toque na tela
  //
  // O reconhecimento de gesto mora em `lib/player/gestos`, porque as quatro
  // intenções que dividem esta superfície — pausar, saltar para trás, saltar
  // para frente, curtir — só se distinguem por tempo e posição, e cada
  // fronteira entre elas tem um jeito próprio de dar errado.
  const { turbo, aviso, manipuladores } = useGestosDoReel({
    videoRef,
    duracaoPadraoSec: lamina.episodio.duracaoSec,
    // Arrastar a barra desliga os gestos de tela: o dedo que navega passa
    // por cima da área de toque, e sem esta porta soltar a alça contaria como
    // toque e pausaria o episódio que a pessoa acabou de posicionar.
    habilitado:
      ativa && !bloqueada && !falhou && fonte !== null && !arrastandoBarra,
    aoAlternarPlay: () => {
      // O primeiro toque depois da imersão só traz a interface de volta. Sem
      // esta porta, quem quisesse ver as ações pausaria o episódio sem querer.
      if (imersivoRef.current) {
        sairDaImersao();
        return;
      }
      adiarImersao();
      alternarPlay();
    },
    aoCurtir: () => {
      adiarImersao();
      setEstouroDeCoracao((n) => n + 1);
      // Toque duplo só curte, nunca descurte: quem bate duas vezes está
      // aplaudindo. Tirar a curtida exige o botão, que é explícito.
      if (!lamina.social.curtido) aoCurtir();
    },
    aoSaltar: (segundos) => {
      adiarImersao();
      track("PLAY_SEEK", {
        episodeId: lamina.episodio.id,
        novelaId: lamina.novela.id,
        payload: { segundos, origem: "reel" },
      });
    },
    aoDeslizar,
  });

  return (
    <section
      data-indice={indice}
      className="lamina-snap relative w-full shrink-0 overflow-hidden bg-black"
      style={{ height: "var(--reel-h)" }}
      aria-label={`${lamina.novela.titulo}, episódio ${lamina.episodio.numero}`}
    >
      {/* Atmosfera com a conversa aberta.

          O vídeo reduzido deixa margem dos lados, e preto chapado ali faz a
          cena parecer uma janela encolhida. A capa desfocada e escura dá à
          margem a cor da própria novela — e fica atrás de tudo, nunca por
          cima do conteúdo. Só existe com a conversa aberta, e só a opacidade
          anima: o desfoque é calculado uma vez, não a cada quadro.

          E só nas lâminas montadas. Uma imagem desfocada de tela inteira por
          lâmina da fila custava o primeiro quadro da abertura — medido: um
          engasgo de 210ms com a CPU a um quarto, antes de o painel sequer
          começar a subir. */}
      {conversa && montada ? (
        <motion.img
          src={lamina.episodio.capaUrl}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full scale-125 object-cover blur-2xl brightness-[0.38] saturate-150"
          style={{ opacity: abertura, willChange: "opacity" }}
        />
      ) : null}

      {/* Palco: tudo o que pertence à cena — cartaz, vídeo e os sinais do
          toque — se move junto. `transform-origin` no topo ao centro, que é o
          ponto a partir do qual o enquadramento é calculado. */}
      <motion.div
        className="absolute inset-0"
        style={{
          scale: escala,
          x,
          y,
          transformOrigin: "50% 0%",
          // Camada própria só onde há vídeo para mover. Promover o palco de
          // cada lâmina da fila gastaria memória de GPU com o que não se vê.
          willChange: conversa && montada ? "transform" : undefined,
        }}
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
            // `max-w-none`: a folha base limita vídeo a 100% da largura, e a
            // caixa de "cobrir" é, de propósito, mais larga que a tela.
            className={
              caixa
                ? "absolute max-w-none object-cover"
                : "absolute inset-0 size-full object-cover"
            }
            style={
              caixa
                ? {
                    width: caixa.largura,
                    height: caixa.altura,
                    left: caixa.esquerda,
                    top: caixa.topo,
                  }
                : undefined
            }
            onLoadedMetadata={() => {
              // Um elemento de vídeo remontado por troca de fonte reinicia em 1x,
              // mas um que só recarregou os metadados mantém o `playbackRate`
              // anterior. Sem esta linha, uma renovação de URL assinada no meio
              // de uma pressão longa deixaria o episódio em 2x sem selo e sem
              // dedo na tela — e nada devolveria a velocidade.
              const video = videoRef.current;
              if (video && !turbo && video.playbackRate !== 1) {
                video.playbackRate = 1;
              }
              if (video && video.videoWidth > 0 && video.videoHeight > 0) {
                setProporcao(video.videoWidth / video.videoHeight);
              }
              posicionar();
            }}
            onTimeUpdate={() => {
              aoAtualizarTempo();
              const video = videoRef.current;
              if (!video) return;
              if (Number.isFinite(video.duration) && video.duration > 0) {
                setDuracaoSec(video.duration);
              }
              setPosicaoSec(video.currentTime);
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

        {/* Aviso de salto. Nasce do lado tocado e soma toques seguidos: quatro
            toques à direita mostram "20s", não quatro vezes "5s". Dentro do
            palco, para aparecer sobre o vídeo onde quer que ele esteja. */}
        <AnimatePresence>
          {aviso ? (
            <motion.div
              key={aviso.chave}
              initial={{ opacity: 0, scale: 0.86 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.16 }}
              aria-hidden
              className={`pointer-events-none absolute top-1/2 z-20 grid size-[5.5rem] -translate-y-1/2 place-items-center rounded-full bg-black/45 backdrop-blur-[2px] ${
                aviso.lado === "tras" ? "left-[8%]" : "right-[8%]"
              }`}
            >
              <span className="flex items-center gap-0.5 text-white">
                <IconeSeta
                  tamanho={15}
                  className={aviso.lado === "tras" ? "rotate-180" : ""}
                />
                <IconeSeta
                  tamanho={15}
                  className={`-ml-2.5 ${aviso.lado === "tras" ? "rotate-180" : ""}`}
                />
              </span>
              <span className="mt-0.5 text-[0.8125rem] font-bold tabular-nums text-white">
                {aviso.segundos}s
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

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
              key="pausa"
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
      </motion.div>

      {/* Camada de gesto. Fica sob os controles laterais e sob o texto, para
          que tocar num link não pause o vídeo por acidente.

          `touch-action: pan-y` cede a rolagem vertical ao trilho — sem isso o
          swipe entre lâminas morreria aqui — e retém o resto, que é o que
          impede o navegador de aplicar o próprio zoom de toque duplo por cima
          do nosso.

          Com a conversa aberta o trilho está travado, e o arrasto vertical
          deixa de ser do navegador: `touch-action: none` entrega o gesto
          inteiro ao reconhecedor, que troca de episódio só num arrasto
          explícito sobre o vídeo — nunca sobre a conversa.

          Não é `<button>`: um botão dispara clique ao soltar a barra de espaço
          e ao pressionar Enter, e a pressão longa do teclado repetiria o
          disparo dezenas de vezes. O papel e o `tabIndex` mantêm o acesso por
          teclado com a semântica que este elemento realmente tem. */}
      {!bloqueada && !falhou ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={tocando ? "Pausar" : "Tocar"}
          {...manipuladores}
          onKeyDown={(evento) => {
            if (evento.key !== "Enter" && evento.key !== " ") return;
            evento.preventDefault();
            if (evento.repeat) return;
            alternarPlay();
          }}
          className={`absolute inset-0 z-10 cursor-default select-none ${
            conversa ? "touch-none" : "touch-pan-y"
          }`}
        />
      ) : null}

      {/* Selo do 2x. Precisa existir: sem ele, quem encostou o dedo sem querer
          não entende por que a novela acelerou. */}
      <AnimatePresence>
        {turbo ? (
          <motion.div
            key="turbo"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            aria-hidden
            className="pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3.5 py-1.5 backdrop-blur-md"
            style={{ top: "calc(var(--safe-t) + 3.25rem)" }}
          >
            <span className="flex text-white">
              <IconeSeta tamanho={13} />
              <IconeSeta tamanho={13} className="-ml-2" />
            </span>
            <span className="text-[0.8125rem] font-bold text-white">
              2x
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* O 2x é anunciado por texto, e não só pelo selo: quem usa leitor de
          tela precisa saber que a velocidade mudou. */}
      <span aria-live="polite" className="sr-only">
        {turbo ? "Velocidade dobrada" : ""}
      </span>

      <div className="veu-superior pointer-events-none absolute inset-x-0 top-0 z-10 h-32" />
      <div
        className={`veu-inferior pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64 transition-opacity duration-300 ${
          conversa ? "opacity-0" : "opacity-100"
        }`}
      />

      {/* Pílula de som: aparece só enquanto o áudio está desligado. */}
      <AnimatePresence>
        {ativa && !somLigado && !bloqueada ? (
          <motion.button
            key="som"
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
                ? "Os capítulos gratuitos terminaram. Crie sua conta para guardar seu progresso e conhecer as opções de assinatura ou compra desta novela."
                : "Assine tudo, ou compre só esta novela e ela é sua para sempre."}
            </p>
            <Link
              onClick={lamina.bloqueio === "precisa-conta" && aoPedirConta ? (e) => { e.preventDefault(); aoPedirConta(); } : undefined}
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
        className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-300 ${
          recuada || imersivo ? "opacity-0" : "opacity-100"
        }`}
      >
        {/* Recuado, o cromo não recebe toque nenhum: invisível e tocável seria
            uma armadilha sobre o vídeo reduzido. */}
        <div className={recuada ? "invisible" : undefined}>
          <AcoesLaterais
            lamina={lamina}
            aoCurtir={aoCurtir}
            aoAbrirComentarios={aoAbrirComentarios}
            aoEnviar={aoEnviar}
          />
        </div>

        {/* ---------------------------------------------------- identidade */}
        <div
          className={`pointer-events-auto absolute inset-x-0 bottom-0 px-4 pr-[4.75rem] ${
            recuada ? "invisible" : ""
          }`}
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

        {/* O bloco de texto some inteiro quando não há texto — em vez de
            reservar um espaço vazio ou repetir a sinopse da obra num episódio
            que ela não descreve. Da segunda lâmina em diante isso é o normal
            enquanto a ingestão não escrever sinopse por episódio, e o título
            com "Ep 4 de 72" já dá o contexto que importa ali. */}
        {lamina.episodio.gancho ? (
          <button
            type="button"
            onClick={() => setSinopseAberta((v) => !v)}
            aria-expanded={sinopseAberta}
            className="mt-1.5 block w-full text-left"
          >
            {/* Sem `block` junto de `line-clamp-2`: as duas utilidades escrevem
                `display`, e a última na folha de estilo vence. Com `block` no
                caminho, o texto abria em nove linhas e cobria a cena inteira —
                o oposto de uma lâmina. */}
            {/* Aberto, o texto ganha teto e rolagem própria: alguns passam de
                dez linhas, e sem teto subiriam além do véu de leitura, com
                letra branca caindo direto sobre a cena clara.
                `overscroll-contain` impede que rolar até o fim vire um swipe. */}
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
        ) : null}

        {lamina.novela.tags.length > 0 ? (
          <p className="mt-2 truncate text-[0.75rem] font-medium text-white/50">
            {lamina.novela.tags.map((tag) => `#${tag}`).join("  ")}
          </p>
        ) : null}
      </div>

      </div>

      {/* A barra fica fora do invólucro do cromo: aquele bloco é
          `pointer-events-none` e some quando um painel sobe, e uma barra que
          não recebe toque é apenas uma linha decorativa. */}
      {!bloqueada && !falhou ? (
        <BarraDeProgresso
          posicaoSec={posicaoSec}
          duracaoSec={duracaoSec}
          accent={lamina.novela.accent}
          // Some junto com o cromo na imersão, e volta ao primeiro toque.
          habilitada={ativa && !recuada && !imersivo}
          recuada={recuada || imersivo}
          aoArrastarMudar={setArrastandoBarra}
          aoNavegar={(segundos) => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = segundos;
            setPosicaoSec(segundos);
            // O progresso sobe na hora: sem isso, sair da lâmina logo após
            // navegar gravaria a posição antiga, e a retomada mandaria a
            // pessoa de volta para onde ela acabou de sair.
            enviar();
            track("PLAY_SEEK", {
              episodeId: lamina.episodio.id,
              novelaId: lamina.novela.id,
              payload: { destinoSec: Math.round(segundos), origem: "barra" },
            });
          }}
        />
      ) : null}
    </section>
  );
}
