"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FolhaComentarios } from "@/components/reel/FolhaComentarios";
import { FolhaEnviar } from "@/components/reel/FolhaEnviar";
import { Lamina } from "@/components/reel/Lamina";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { useToast } from "@/components/sistema/ToastProvider";
import {
  carregarMaisLaminas,
  curtirEpisodio,
  emendarSerie,
  registrarDescarte,
  registrarPermanencia,
} from "@/lib/actions/reel";
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

type Folha =
  | { tipo: "comentarios"; laminaId: string }
  | { tipo: "enviar"; laminaId: string }
  | null;

export function Reel({
  laminasIniciais,
  economiaDeDados,
  temConta,
}: {
  laminasIniciais: LaminaReel[];
  economiaDeDados: boolean;
  temConta: boolean;
}) {
  const { sessionId } = useTelemetry();
  const toast = useToast();

  const [laminas, setLaminas] = useState(laminasIniciais);
  const [ativo, setAtivo] = useState(0);
  const [somLigado, setSomLigado] = useState(true);
  const [contabilizavel, setContabilizavel] = useState(false);
  const [folha, setFolha] = useState<Folha>(null);

  const trilhoRef = useRef<HTMLDivElement>(null);
  const laminasRef = useRef(laminas);
  laminasRef.current = laminas;

  // ------------------------------------------------------ altura travada
  const [altura, setAltura] = useState<number | null>(null);

  useEffect(() => {
    const medir = () => setAltura(window.innerHeight);
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
      if (emendandoRef.current.has(lamina.episodio.id)) return;
      emendandoRef.current.add(lamina.episodio.id);

      const resultado = await emendarSerie({
        novelaId: lamina.novela.id,
        depoisDoEpisodioId: lamina.episodio.id,
        jaNaFila: laminasRef.current.map((l) => l.episodio.id),
      }).catch(() => null);

      if (!resultado || resultado.laminas.length === 0) return;

      setLaminas((atual) => {
        const posicao = atual.findIndex(
          (l) => l.episodio.id === lamina.episodio.id,
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
        toast.show("Entre para curtir episódios.", "neutro");
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

  // ------------------------------------------------------ fim do episódio
  //
  // Terminar um episódio desliza para o próximo sozinho. É a diferença entre
  // uma fila e uma sequência de vídeos avulsos — e é também o que mantém a
  // narrativa andando sem exigir um gesto a cada capítulo.
  const avancar = useCallback(() => {
    const trilho = trilhoRef.current;
    if (!trilho) return;
    const proximo = trilho.children[ativo + 1] as HTMLElement | undefined;
    proximo?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ativo]);

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
          } as React.CSSProperties
        }
      >
        {laminas.map((lamina, indice) => (
            <Lamina
              key={lamina.chave}
              indice={indice}
              lamina={lamina}
              ativa={indice === ativo && folha === null}
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
              aoAbrirComentarios={() =>
                setFolha({ tipo: "comentarios", laminaId: lamina.episodio.id })
              }
              aoEnviar={() =>
                setFolha({ tipo: "enviar", laminaId: lamina.episodio.id })
              }
            />
        ))}
      </div>

      {laminaDaFolha && folha?.tipo === "comentarios" ? (
        <FolhaComentarios
          lamina={laminaDaFolha}
          temConta={temConta}
          aoFechar={() => setFolha(null)}
          aoMudarTotal={(total) =>
            ajustarContagem(laminaDaFolha.episodio.id, "comentarios", total)
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
