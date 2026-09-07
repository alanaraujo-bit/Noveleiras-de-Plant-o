"use client";

import { useEffect } from "react";

/**
 * Leva as preferências do espectador para o documento, onde o CSS e o player
 * conseguem enxergá-las.
 *
 * Sem isto, "reduzir animações" e "economia de dados" seriam interruptores
 * bonitos e inúteis: a escolha ficaria no banco sem mudar nada na tela.
 */
export function AplicarPreferencias({
  reduzirMovimento,
  economiaDeDados,
}: {
  reduzirMovimento: boolean;
  economiaDeDados: boolean;
}) {
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.dataset.movimento = reduzirMovimento ? "reduzido" : "normal";
    raiz.dataset.dados = economiaDeDados ? "economia" : "normal";
  }, [reduzirMovimento, economiaDeDados]);

  return null;
}
