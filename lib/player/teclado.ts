"use client";

import { useEffect, useState } from "react";

/**
 * O que o teclado virtual e o navegador fizeram com a tela.
 *
 * No celular o teclado sobe **por cima** de elementos fixos, e o iOS ainda
 * rola o viewport visual para mostrar o campo em foco. Só o `visualViewport`
 * sabe as duas coisas: quanto sobrou embaixo (o teclado) e quanto do topo saiu
 * de vista (o deslocamento). O painel usa a primeira para ficar acima do
 * teclado; o vídeo usa a segunda para não ficar escondido acima da tela.
 */
export type ViewportVisual = {
  teclado: number;
  deslocamentoTopo: number;
};

const NADA: ViewportVisual = { teclado: 0, deslocamentoTopo: 0 };

/**
 * Abaixo disto a diferença é barra de ferramentas do navegador recolhendo, não
 * teclado. Reagir a ela faria o vídeo pulsar a cada rolagem.
 */
const MENOR_TECLADO_PX = 80;

/**
 * Só escuta enquanto `ativo`: fora da conversa não há campo de texto, e um
 * ouvinte de `resize` a cada movimento da barra de endereço seria custo sem
 * retorno. As leituras são agrupadas por quadro — o iOS dispara vários eventos
 * durante a subida do teclado, e cada um viraria uma renderização.
 */
export function useViewportVisual(ativo: boolean): ViewportVisual {
  const [estado, setEstado] = useState<ViewportVisual>(NADA);

  useEffect(() => {
    if (!ativo) {
      setEstado(NADA);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    let quadro = 0;
    const medir = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const bruto = Math.round(window.innerHeight - vv.height - vv.offsetTop);
        const teclado = bruto < MENOR_TECLADO_PX ? 0 : bruto;
        const deslocamentoTopo = Math.max(0, Math.round(vv.offsetTop));
        setEstado((antes) =>
          antes.teclado === teclado && antes.deslocamentoTopo === deslocamentoTopo
            ? antes
            : { teclado, deslocamentoTopo },
        );
      });
    };

    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    return () => {
      cancelAnimationFrame(quadro);
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
    };
  }, [ativo]);

  return estado;
}

/**
 * A área segura do topo, em pixels.
 *
 * `--safe-t` é CSS (`env(safe-area-inset-top)` com um mínimo), mas o
 * enquadramento é aritmética: precisa do número. Uma sonda invisível resolve a
 * variável uma vez e sai.
 */
export function medirTopoSeguro(): number {
  if (typeof document === "undefined") return 0;
  const sonda = document.createElement("div");
  sonda.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:var(--safe-t)";
  document.body.appendChild(sonda);
  const valor = parseFloat(getComputedStyle(sonda).paddingTop) || 0;
  sonda.remove();
  return valor;
}
