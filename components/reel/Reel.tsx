"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type Transition,
} from "motion/react";

import { Comentarios } from "@/components/reel/Comentarios";
import { ConviteConta, PEDIR_CONTA } from "@/components/reel/ConviteConta";
import { FolhaEnviar } from "@/components/reel/FolhaEnviar";
import { Lamina } from "@/components/reel/Lamina";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { useToast } from "@/components/sistema/ToastProvider";
import {
  carregarMaisLaminas,
  curtirEpisodio,
  emendarSerie,
  recarregarFila,
  registrarDescarte,
  registrarPermanencia,
} from "@/lib/actions/reel";
import { layoutDaConversa } from "@/lib/player/enquadramento";
import { pontoDeExtensao } from "@/lib/player/estado-reel";
import { medirTopoSeguro, useViewportVisual } from "@/lib/player/teclado";
import { ouvirAbaReativada } from "@/lib/shell/aba-reativada";
import type { LaminaReel } from "@/lib/repositories/reel";

/**
 * O reel.
 *
 * A fila é uma lista viva na memória desta tela, e não uma rota. Esse é o
 * ponto de partida de todas as decisões abaixo: o servidor entrega a primeira
 * página e depois só responde perguntas — nenhuma ação revalida a rota, porque
 * revalidar remontaria a fila e jogaria a pessoa de volta à primeira lâmina no
 * meio de um gesto.
 *
 * Três mecanismos sustentam a sensação de fluidez:
 *
 * 1. **Janela de montagem.** Só três `<video>` existem no documento por vez:
 *    o anterior, o atual e o próximo. Uma lista com quarenta elementos de
 *    vídeo esgota os decodificadores do aparelho e o quarto vídeo simplesmente
 *    não toca — sem erro, sem aviso.
 *
 * 2. **Altura travada.** A barra de endereço do navegador móvel encolhe e
 *    cresce durante a rolagem. Deixar a lâmina reagir a isso mudaria a altura
 *    do encaixe no meio do swipe, e o encaixe erraria o alvo.
 *
 * 3. **Limiar de permanência.** Passar o dedo não é assistir. Só depois do
 *    limiar a lâmina conta visualização, grava progresso e emenda a série.
 */

/** Tempo em cena a partir do qual a lâmina passa a valer como assistida. */
const LIMIAR_PERMANENCIA_MS = 1800;
/** Distância do fim da fila em que a próxima página é pedida. */
const FOLGA_PARA_CARREGAR = 4;

/**
 * O movimento da conversa: vídeo e painel juntos.
 *
 * Mola criticamente amortecida — acelera e desacelera como coisa física, sem
 * quicar. Mola, e não curva de tempo fixo, porque a conversa também abre e
 * fecha pelo dedo: quando o arrasto solta no meio, a mola herda a velocidade do
 * gesto e termina o movimento sem tranco.
 */
const MOLA_DA_CONVERSA: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 36,
  mass: 1,
  restDelta: 0.0005,
};

type Folha =
  | { tipo: "comentarios"; laminaId: string }
  | { tipo: "enviar"; laminaId: string }
  | null;

export function Reel({
  laminasIniciais,
  economiaDeDados,
  viewer,
}: {
  laminasIniciais: LaminaReel[];
  economiaDeDados: boolean;
  /** Nulo enquanto a visitante explora os capítulos gratuitos. */
  viewer: { nome: string; avatarSeed: string; avatarUrl: string | null } | null;
}) {
  const temConta = viewer !== null;
  const { sessionId } = useTelemetry();
  const toast = useToast();

  const [laminas, setLaminas] = useState(laminasIniciais);
  const [ativo, setAtivo] = useState(0);
  const [somLigado, setSomLigado] = useState(true);
  const [contabilizavel, setContabilizavel] = useState(false);
  const [folha, setFolha] = useState<Folha>(null);
  const [conviteAberto, setConviteAberto] = useState(false);

  const trilhoRef = useRef<HTMLDivElement>(null);
  const laminasRef = useRef(laminas);
  laminasRef.current = laminas;
  const ativoRef = useRef(ativo);
  ativoRef.current = ativo;
  const folhaRef = useRef(folha);
  folhaRef.current = folha;

  // ------------------------------------------------------ altura travada
  const [tela, setTela] = useState<{ largura: number; altura: number } | null>(
    null,
  );
  const altura = tela?.altura ?? null;
  const [topoSeguro, setTopoSeguro] = useState(0);

  useEffect(() => {
    const medir = () => {
      setTela({ largura: window.innerWidth, altura: window.innerHeight });
      setTopoSeguro(medirTopoSeguro());
    };
    medir();

    // Só a largura conta como "mudou de verdade". Uma variação de altura
    // isolada é a barra de endereço encolhendo — reagir a ela reposicionaria
    // o encaixe no meio da rolagem.
    let larguraAnterior = window.innerWidth;
    const aoRedimensionar = () => {
      if (window.innerWidth === larguraAnterior) return;
      larguraAnterior = window.innerWidth;
      medir();
    };

    window.addEventListener("resize", aoRedimensionar);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", aoRedimensionar);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);

  // A superfície do reel desliga o grão de impressão do resto do app.
  useEffect(() => {
    document.documentElement.dataset.superficie = "reel";
    return () => {
      delete document.documentElement.dataset.superficie;
    };
  }, []);

  // ------------------------------------------------- lâmina em cena
  //
  // O observador decide quem está em cena. Calcular pela posição de rolagem
  // pareceria mais simples e erraria: durante o encaixe elástico do iOS a
  // posição passa do alvo e volta, e o vídeo trocaria duas vezes por swipe.
  useEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho || altura === null) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) continue;
          const indice = Number(
            (entrada.target as HTMLElement).dataset.indice ?? "-1",
          );
          if (indice >= 0) setAtivo(indice);
        }
      },
      { root: trilho, threshold: 0.62 },
    );

    for (const filho of Array.from(trilho.children)) {
      observador.observe(filho);
    }
    return () => observador.disconnect();
  }, [altura, laminas.length]);

  // ------------------------------------- permanência, descarte e emenda
  const entradaRef = useRef<{ indice: number; em: number }>({
    indice: 0,
    em: Date.now(),
  });

  const emendandoRef = useRef(new Set<string>());

  /**
   * Costura os próximos episódios de uma novela logo abaixo do gancho dela.
   *
   * O conjunto de controle existe porque a permanência pode disparar de novo
   * quando a pessoa volta uma lâmina e avança outra vez — e a segunda emenda
   * duplicaria os mesmos episódios no meio da fila.
   */
  const emendarAbaixo = useCallback(
    async (lamina: LaminaReel) => {
      const filaAoPedir = laminasRef.current;
      const indiceAtual = filaAoPedir.findIndex(
        (item) => item.episodio.id === lamina.episodio.id,
      );
      const ponto = pontoDeExtensao(filaAoPedir, indiceAtual);
      if (!ponto || emendandoRef.current.has(ponto.ancora.episodio.id)) return;
      emendandoRef.current.add(ponto.ancora.episodio.id);

      const resultado = await emendarSerie({
        novelaId: lamina.novela.id,
        depoisDoEpisodioId: ponto.ancora.episodio.id,
        jaNaFila: filaAoPedir.map((l) => l.episodio.id),
      }).catch(() => null);

      // Falha de rede nao pode transformar o fim deste lote no fim da novela.
      // Libera a ancora para a proxima lamina tentar novamente. Resultado
      // vazio, por outro lado, e o fim real da obra e permanece memorizado.
      if (!resultado) {
        emendandoRef.current.delete(ponto.ancora.episodio.id);
        return;
      }
      if (resultado.laminas.length === 0) return;

      setLaminas((atual) => {
        const posicao = atual.findIndex(
          (l) => l.episodio.id === ponto.ancora.episodio.id,
        );
        if (posicao < 0) return atual;
        const conhecidos = new Set(atual.map((l) => l.episodio.id));
        const novas = resultado.laminas.filter(
          (l) => !conhecidos.has(l.episodio.id),
        );
        if (novas.length === 0) return atual;
        return [
          ...atual.slice(0, posicao + 1),
          ...novas,
          ...atual.slice(posicao + 1),
        ];
      });
    },
    [],
  );

  /** Lâminas cuja permanência já foi registrada. Uma visualização por lâmina. */
  const registradasRef = useRef(new Set<string>());

  // O identificador da lâmina em cena é a única coisa que pode reiniciar este
  // efeito. Depender do array `laminas` reiniciaria o relógio a cada curtida,
  // emenda ou página nova — e cada reinício contaria uma visualização a mais
  // para o mesmo episódio, que é exatamente o que o limiar existe para evitar.
  const idEmCena = laminas[ativo]?.episodio.id;

  useEffect(() => {
    if (!idEmCena) return;

    const laminasAgora = laminasRef.current;
    const lamina = laminasAgora.find((l) => l.episodio.id === idEmCena);
    if (!lamina) return;

    // Uma serie ja escolhida antecipa o proximo lote assim que entra em cena.
    // Isso garante tanto a sequencia de assinantes quanto a lamina de bloqueio
    // logo depois do quinto episodio gratuito, mesmo com swipes rapidos.
    if (lamina.origem === "serie") void emendarAbaixo(lamina);

    const anterior = entradaRef.current;

    // A lâmina que acabou de sair de cena: se ficou menos que o limiar, foi
    // descartada. Esse fato é tão útil quanto a visualização — é ele que diz
    // se um gancho está segurando alguém.
    if (anterior.indice !== ativo) {
      const anteriorLamina = laminasAgora[anterior.indice];
      const permanencia = Date.now() - anterior.em;
      if (
        anteriorLamina &&
        anteriorLamina.episodio.id !== idEmCena &&
        permanencia < LIMIAR_PERMANENCIA_MS
      ) {
        void registrarDescarte({
          episodeId: anteriorLamina.episodio.id,
          novelaId: anteriorLamina.novela.id,
          msNaLamina: permanencia,
        });
      }
    }

    entradaRef.current = { indice: ativo, em: Date.now() };
    setContabilizavel(false);

    const relogio = window.setTimeout(() => {
      setContabilizavel(true);

      if (!registradasRef.current.has(lamina.episodio.id)) {
        registradasRef.current.add(lamina.episodio.id);
        void registrarPermanencia({
          episodeId: lamina.episodio.id,
          novelaId: lamina.novela.id,
          origem: lamina.origem,
        });
      }

      // A pessoa ficou num gancho: a novela dele passa a ser a série corrente,
      // e os próximos episódios são costurados logo abaixo. É aqui que
      // "descobri" vira "estou assistindo", sem tela intermediária.
      if (lamina.origem === "gancho") void emendarAbaixo(lamina);
    }, LIMIAR_PERMANENCIA_MS);

    return () => window.clearTimeout(relogio);
  }, [ativo, emendarAbaixo, idEmCena]);

  // ------------------------------------------------- fila que não acaba
  const carregandoRef = useRef(false);

  useEffect(() => {
    if (ativo < laminas.length - FOLGA_PARA_CARREGAR) return;
    if (carregandoRef.current) return;
    carregandoRef.current = true;

    void carregarMaisLaminas([
      ...new Set(laminasRef.current.map((l) => l.novela.id)),
    ])
      .then((resultado) => {
        if (!resultado.ok || resultado.laminas.length === 0) return;
        setLaminas((atual) => {
          const conhecidos = new Set(atual.map((l) => l.episodio.id));
          const novas = resultado.laminas.filter(
            (l) => !conhecidos.has(l.episodio.id),
          );
          return novas.length > 0 ? [...atual, ...novas] : atual;
        });
      })
      .catch(() => {})
      .finally(() => {
        carregandoRef.current = false;
      });
  }, [ativo, laminas.length]);

  // ------------------------------------------------------------ curtir
  const curtir = useCallback(
    (laminaId: string) => {
      if (!temConta) {
        window.dispatchEvent(new CustomEvent(PEDIR_CONTA, { detail: "curtir" }));
        return;
      }

      // Otimista: o coração pinta no quadro do toque. O servidor devolve a
      // contagem verdadeira e ela substitui a estimativa — se a escrita
      // falhar, o estado volta ao que era.
      let anterior: LaminaReel["social"] | null = null;
      setLaminas((atual) =>
        atual.map((l) => {
          if (l.episodio.id !== laminaId) return l;
          anterior = l.social;
          const curtido = !l.social.curtido;
          return {
            ...l,
            social: {
              ...l.social,
              curtido,
              curtidas: Math.max(0, l.social.curtidas + (curtido ? 1 : -1)),
            },
          };
        }),
      );

      void curtirEpisodio(laminaId)
        .then((resultado) => {
          if (!resultado.ok) throw new Error(resultado.motivo);
          setLaminas((atual) =>
            atual.map((l) =>
              l.episodio.id === laminaId
                ? {
                    ...l,
                    social: {
                      ...l.social,
                      curtido: resultado.curtido,
                      curtidas: resultado.curtidas,
                    },
                  }
                : l,
            ),
          );
        })
        .catch(() => {
          if (!anterior) return;
          const restaurar = anterior;
          setLaminas((atual) =>
            atual.map((l) =>
              l.episodio.id === laminaId ? { ...l, social: restaurar } : l,
            ),
          );
          toast.show("Não deu para registrar a curtida.", "ruim");
        });
    },
    [temConta, toast],
  );

  const ajustarContagem = useCallback(
    (laminaId: string, campo: "comentarios" | "envios", valor: number) => {
      setLaminas((atual) =>
        atual.map((l) =>
          l.episodio.id === laminaId
            ? { ...l, social: { ...l.social, [campo]: valor } }
            : l,
        ),
      );
    },
    [],
  );

  // ------------------------------------------------------------ conversa
  //
  // Abrir a conversa não é abrir uma tela: é a cena abrir espaço. Um único
  // valor — `abertura`, de 0 a 1 — move o painel e reenquadra o vídeo ao mesmo
  // tempo, e é lido direto pelo motion, sem render do React a cada quadro.
  const abertura = useMotionValue(0);
  const reduzidoPeloSistema = useReducedMotion();
  const [reduzidoPeloApp, setReduzidoPeloApp] = useState(false);
  useEffect(() => {
    setReduzidoPeloApp(
      document.documentElement.dataset.movimento === "reduzido",
    );
  }, []);
  const reduzido = Boolean(reduzidoPeloSistema) || reduzidoPeloApp;
  const transicao: Transition = useMemo(
    () => (reduzido ? { duration: 0 } : MOLA_DA_CONVERSA),
    [reduzido],
  );

  const conversaAberta = folha?.tipo === "comentarios";
  const viewport = useViewportVisual(conversaAberta);

  // A barra de abas sai de cena com a conversa aberta, pelo mesmo sinal no
  // elemento raiz que a imersão já usa. Sem isso, no desktop, ela ficaria por
  // cima da parte de baixo do vídeo reenquadrado.
  useEffect(() => {
    if (!conversaAberta) return;
    const raiz = document.documentElement;
    raiz.dataset.conversa = "1";
    return () => {
      delete raiz.dataset.conversa;
    };
  }, [conversaAberta]);

  const layout = useMemo(
    () =>
      conversaAberta && tela
        ? layoutDaConversa({
            largura: tela.largura,
            altura: tela.altura,
            teclado: viewport.teclado,
            topo: topoSeguro + viewport.deslocamentoTopo,
          })
        : null,
    [conversaAberta, tela, topoSeguro, viewport.deslocamentoTopo, viewport.teclado],
  );

  /**
   * Cada abertura e cada fechamento ganha um número. Fechar e reabrir no meio
   * da animação é comum — dedo rápido, arrependimento —, e o fim de um
   * fechamento antigo não pode desmontar uma conversa que acabou de reabrir.
   */
  const geracaoRef = useRef(0);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);
  /** Há texto no campo: a conversa não pode sumir debaixo do que ela escreve. */
  const rascunhoRef = useRef(false);
  /** O episódio acabou enquanto ela escrevia; o avanço espera o texto. */
  const avancoPendenteRef = useRef(false);

  const abrirComentarios = useCallback(
    (laminaId: string) => {
      geracaoRef.current += 1;
      if (!folhaRef.current) {
        focoAnteriorRef.current = document.activeElement as HTMLElement | null;
      }
      setFolha({ tipo: "comentarios", laminaId });
      void animate(abertura, 1, transicao);
    },
    [abertura, transicao],
  );

  // ------------------------------------------------------ fim do episódio
  //
  // Terminar um episódio desliza para o próximo sozinho. É a diferença entre
  // uma fila e uma sequência de vídeos avulsos — e é também o que mantém a
  // narrativa andando sem exigir um gesto a cada capítulo.

  /**
   * Salta para a lâmina vizinha, sem rolagem animada.
   *
   * Com a conversa aberta o vídeo ocupa só o alto da tela, e uma rolagem
   * animada de uma lâmina inteira faria a faixa vazia entre duas cenas
   * atravessar a área do vídeo. O salto troca a cena como um corte de novela:
   * o próximo episódio já nasce enquadrado acima da conversa.
   */
  const irPara = useCallback((sentido: 1 | -1) => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const alvo = trilho.children[ativoRef.current + sentido] as
      | HTMLElement
      | undefined;
    if (!alvo) return;
    trilho.scrollTo({ top: alvo.offsetTop, behavior: "instant" });
  }, []);

  const avancar = useCallback(() => {
    if (folhaRef.current?.tipo === "comentarios") {
      // Ela está escrevendo sobre este episódio. Trocar agora faria o texto
      // ir parar na conversa do próximo; o avanço espera.
      if (rascunhoRef.current) {
        avancoPendenteRef.current = true;
        return;
      }
      irPara(1);
      return;
    }
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const proximo = trilho.children[ativoRef.current + 1] as HTMLElement | undefined;
    proximo?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [irPara]);

  const fecharComentarios = useCallback(() => {
    geracaoRef.current += 1;
    const geracao = geracaoRef.current;
    void animate(abertura, 0, transicao).then(() => {
      if (geracaoRef.current !== geracao) return;
      setFolha((f) => (f?.tipo === "comentarios" ? null : f));
      // O foco volta para quem abriu — o botão de comentários —, e não para o
      // topo do documento. Sem isso, quem navega por teclado recomeçaria a
      // tela inteira a cada conversa fechada.
      focoAnteriorRef.current?.focus?.({ preventScroll: true });
      focoAnteriorRef.current = null;
      rascunhoRef.current = false;
      if (avancoPendenteRef.current) {
        avancoPendenteRef.current = false;
        avancar();
      }
    });
  }, [abertura, avancar, transicao]);

  const aoRascunho = useCallback(
    (temTexto: boolean) => {
      rascunhoRef.current = temTexto;
      if (!temTexto && avancoPendenteRef.current) {
        avancoPendenteRef.current = false;
        avancar();
      }
    },
    [avancar],
  );

  // A conversa acompanha o episódio em cena. Trocar de episódio com ela aberta
  // — arrasto sobre o vídeo, ou o fim do episódio — mantém o painel de pé e
  // traz a conversa do episódio novo, em vez de fechar e obrigar a reabrir.
  useEffect(() => {
    if (!idEmCena) return;
    setFolha((f) =>
      f?.tipo === "comentarios" && f.laminaId !== idEmCena
        ? { tipo: "comentarios", laminaId: idEmCena }
        : f,
    );
  }, [idEmCena]);

  // ------------------------------------------------ tocar na aba de novo
  //
  // Dois passos, como em qualquer aplicativo do gênero: se a pessoa desceu na
  // fila, o primeiro toque a leva de volta ao topo; estando no topo, o toque
  // recarrega. Recarregar direto de dentro da fila apagaria o lugar onde ela
  // estava sem ela ter pedido isso.
  const [recarregando, setRecarregando] = useState(false);
  const recarregandoRef = useRef(false);

  const irAoTopo = useCallback((suave: boolean) => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    trilho.scrollTo({ top: 0, behavior: suave ? "smooth" : "auto" });
  }, []);

  const recarregar = useCallback(async () => {
    if (recarregandoRef.current) return;
    recarregandoRef.current = true;
    setRecarregando(true);

    // Um piscar da tela inteira seria pior que a espera. O indicador é uma
    // pílula no topo; a fila fica onde está até a nova chegar.
    const resultado = await recarregarFila().catch(() => null);

    if (resultado?.ok && resultado.laminas.length > 0) {
      // Zerar a permanência registrada permite que a fila nova conte suas
      // próprias visualizações — sem isso, um episódio repetido entre as duas
      // filas nunca mais contaria.
      registradasRef.current = new Set();
      emendandoRef.current = new Set();
      setLaminas(resultado.laminas);
      setAtivo(0);
      // O salto acontece no mesmo quadro da troca: rolar suavemente por uma
      // lista que acabou de ser substituída atravessaria lâminas que a pessoa
      // nunca pediu para ver.
      irAoTopo(false);
    } else if (!resultado?.ok) {
      toast.show("Não deu para atualizar agora.", "ruim");
    }

    // Um mínimo de permanência do indicador. Uma resposta instantânea faria a
    // pílula piscar sem que se lesse nada, e o gesto pareceria não ter feito
    // efeito nenhum.
    window.setTimeout(() => {
      setRecarregando(false);
      recarregandoRef.current = false;
    }, 260);
  }, [irAoTopo, toast]);

  useEffect(
    () =>
      ouvirAbaReativada("/plantao", () => {
        const trilho = trilhoRef.current;
        // Meia lâmina de tolerância. `scrollTop` raramente é zero exato depois
        // de um encaixe elástico, e exigir zero deixaria o toque sem efeito
        // justamente na primeira lâmina, onde ele mais é usado.
        const alturaDaLamina = altura ?? window.innerHeight;
        const noTopo = !trilho || trilho.scrollTop < alturaDaLamina * 0.5;

        if (noTopo) {
          // Um toque leve confirma o gesto onde o aparelho permite. É o que
          // separa "recarregou" de "não aconteceu nada" quando a fila volta
          // igual — o caso mais comum, já que ela só muda quando algo mudou.
          navigator.vibrate?.(8);
          void recarregar();
        } else {
          irAoTopo(true);
        }
      }),
    [altura, irAoTopo, recarregar],
  );

  const laminaDaFolha = folha
    ? laminas.find((l) => l.episodio.id === folha.laminaId)
    : undefined;

  return (
    <>
      <div
        ref={trilhoRef}
        className="trilho-reel fixed inset-0 z-40 bg-black"
        style={
          {
            "--reel-h": altura ? `${altura}px` : "100dvh",
            height: altura ? `${altura}px` : "100dvh",
            // Com a conversa aberta o trilho não rola. É a garantia de que
            // nenhum gesto na conversa — rolar a lista até o fim, arrastar o
            // painel — possa virar troca de episódio. A troca continua possível,
            // mas só por um arrasto explícito sobre o vídeo.
            ...(conversaAberta ? { overflowY: "hidden" } : {}),
          } as React.CSSProperties
        }
      >
        {laminas.map((lamina, indice) => (
            <Lamina
              key={lamina.chave}
              indice={indice}
              lamina={lamina}
              // A lâmina continua tocando com o painel de comentários aberto.
              // Amarrar `ativa` à folha pausava o episódio no instante em que a
              // pessoa ia falar sobre ele — e um reel que congela ao ser
              // comentado deixa de ser um reel.
              ativa={indice === ativo && !conviteAberto}
              visitante={!temConta}
              aoPedirConta={() => window.dispatchEvent(new CustomEvent(PEDIR_CONTA, { detail: "limite" }))}
              // O cromo some enquanto o painel está de pé: com a conversa
              // aberta a cena é o vídeo reenquadrado, e a coluna de ações
              // competiria com ele.
              recuada={folha !== null}
              // A janela de montagem: o anterior continua montado para que
              // voltar um passo não recomece o vídeo do zero.
              montada={Math.abs(indice - ativo) <= 1}
              somLigado={somLigado}
              economiaDeDados={economiaDeDados}
              contabilizavel={indice === ativo && contabilizavel}
              sessionId={sessionId}
              aoBarrarSom={() => setSomLigado(false)}
              aoAlternarSom={() => setSomLigado((v) => !v)}
              aoTerminar={avancar}
              aoCurtir={() => curtir(lamina.episodio.id)}
              aoAbrirComentarios={() => abrirComentarios(lamina.episodio.id)}
              aoEnviar={() =>
                setFolha({ tipo: "enviar", laminaId: lamina.episodio.id })
              }
              abertura={abertura}
              tela={tela}
              // Só a janela de montagem recebe a geometria: a lâmina em cena e
              // as vizinhas, para que o arrasto troque de episódio com a
              // próxima já enquadrada. As demais não têm vídeo, e reenquadrá-
              // las seria trabalho no quadro mais sensível da abertura.
              conversa={Math.abs(indice - ativo) <= 1 ? layout : null}
              aoDeslizar={conversaAberta && indice === ativo ? irPara : undefined}
              reduzido={reduzido}
            />
        ))}
      </div>

      {!temConta && laminas[ativo] && <ConviteConta
        episodioId={laminas[ativo].episodio.id}
        titulo={laminas[ativo].novela.titulo}
        suspenso={folha !== null}
        aoAbrir={setConviteAberto}
      />}

      {/* Indicador da recarga. Uma pílula que desce do topo, some sozinha e
          nunca cobre a cena — o oposto de uma tela de carregamento. */}
      <AnimatePresence>
        {recarregando ? (
          <motion.div
            key="recarregando"
            initial={{ opacity: 0, y: -28, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 480, damping: 32 }}
            className="pointer-events-none fixed inset-x-0 z-[75] flex justify-center"
            style={{ top: "calc(var(--safe-t) + 0.75rem)" }}
          >
            <span className="flex items-center gap-2 rounded-full bg-black/65 px-3.5 py-2 backdrop-blur-md">
              <span
                aria-hidden
                className="size-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white"
              />
              <span className="text-[0.8125rem] font-semibold text-white">
                Atualizando
              </span>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* A recarga é anunciada por texto para quem usa leitor de tela: a
          pílula é visual, e o gesto precisa ser perceptível sem ela. */}
      <span aria-live="polite" className="sr-only">
        {recarregando ? "Atualizando o plantão" : ""}
      </span>

      {/* A conversa não entra num `AnimatePresence` nem ganha `key` por
          episódio: a vida dela é conduzida por `abertura`, e trocar de
          episódio com ela aberta atualiza o conteúdo sem desmontar o painel. */}
      {conversaAberta && laminaDaFolha && layout ? (
        <Comentarios
          lamina={laminaDaFolha}
          abertura={abertura}
          layout={layout}
          transicao={transicao}
          viewer={viewer}
          aoFechar={fecharComentarios}
          aoRascunho={aoRascunho}
          aoMudarTotal={(episodioId, total) =>
            ajustarContagem(episodioId, "comentarios", total)
          }
        />
      ) : null}

      {laminaDaFolha && folha?.tipo === "enviar" ? (
        <FolhaEnviar
          lamina={laminaDaFolha}
          aoFechar={() => setFolha(null)}
          aoContar={(envios) =>
            ajustarContagem(laminaDaFolha.episodio.id, "envios", envios)
          }
        />
      ) : null}
    </>
  );
}
