"use client";

/**
 * Tocar de novo na aba em que já se está.
 *
 * A barra de abas mora no layout do aplicativo e a tela que responde ao toque
 * mora na página — dois lados que nunca se veem. Um evento no `window` é a
 * ligação mais leve possível entre eles: nenhum contexto novo em volta da
 * árvore inteira, nenhum estado global, e a barra continua sem saber o que
 * cada tela faz com o aviso.
 *
 * O contrato tem uma parte importante: o emissor **não decide** o que
 * acontece. Ele diz "tocaram na aba de novo"; a tela escolhe entre voltar ao
 * topo, recarregar ou ignorar, porque só ela sabe onde a pessoa está.
 */

const EVENTO = "nvl:aba-reativada";

export type AbaReativada = { href: string };

/** Avisa que a aba atual foi tocada estando já ativa. */
export function avisarAbaReativada(href: string): void {
  window.dispatchEvent(
    new CustomEvent<AbaReativada>(EVENTO, { detail: { href } }),
  );
}

/**
 * Escuta os toques na aba indicada. Devolve a função de cancelamento — a
 * assinatura que `useEffect` já espera receber de volta.
 */
export function ouvirAbaReativada(
  href: string,
  aoReativar: () => void,
): () => void {
  const ouvinte = (evento: Event) => {
    const detalhe = (evento as CustomEvent<AbaReativada>).detail;
    if (detalhe?.href === href) aoReativar();
  };
  window.addEventListener(EVENTO, ouvinte);
  return () => window.removeEventListener(EVENTO, ouvinte);
}
