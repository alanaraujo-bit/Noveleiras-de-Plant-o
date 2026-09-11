export type ItemSequencial = {
  episodio: { id: string };
  novela: { id: string };
  bloqueio: unknown | null;
};

/** Encontra o fim do bloco contiguo da novela em cena. */
export function pontoDeExtensao<T extends ItemSequencial>(
  fila: T[],
  indiceAtivo: number,
): { ancora: T; indice: number } | null {
  const atual = fila[indiceAtivo];
  if (!atual || atual.bloqueio !== null) return null;

  let indice = indiceAtivo;
  while (fila[indice + 1]?.novela.id === atual.novela.id) indice += 1;

  const bloco = fila.slice(indiceAtivo, indice + 1);
  if (bloco.some((item) => item.bloqueio !== null)) return null;
  return { ancora: fila[indice], indice };
}

/** So uma recusa real de autoplay autoriza desligar o som da sessao inteira. */
export function foiBloqueioDeAutoplay(erro: unknown) {
  return (
    typeof erro === "object" &&
    erro !== null &&
    "name" in erro &&
    erro.name === "NotAllowedError"
  );
}
