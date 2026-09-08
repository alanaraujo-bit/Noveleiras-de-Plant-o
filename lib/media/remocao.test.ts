import { describe, expect, it } from "vitest";

import { podeRemover } from "@/lib/media/biblioteca";

/**
 * A decisão mais perigosa da varredura.
 *
 * De um lado, o fluxo que se espera: apaguei a novela da pasta, escaneio, ela
 * some do aplicativo. Do outro, o acidente que não se pode cometer: o HD
 * externo estava desconectado e a varredura apagou a biblioteca inteira.
 *
 * Os dois casos chegam ao código iguais — "não achei o arquivo" —, e a única
 * pista que os separa é se a varredura encontrou ALGUMA coisa.
 */
describe("podeRemover", () => {
  it("remove quando a varredura achou arquivos e alguns sumiram", () => {
    // 139 arquivos vistos, 141 conhecidos: dois episódios foram apagados.
    expect(podeRemover(139, 141)).toBe(true);
  });

  // O caso do cabo solto: o disco não respondeu, e nada foi encontrado.
  // Apagar aqui destruiria um catálogo inteiro por um problema de hardware.
  it("preserva o catálogo quando NADA foi encontrado", () => {
    expect(podeRemover(0, 141)).toBe(false);
  });

  it("não faz nada quando não havia catálogo", () => {
    expect(podeRemover(0, 0)).toBe(false);
    expect(podeRemover(139, 0)).toBe(false);
  });

  // Uma biblioteca com um episódio só, cujo arquivo sumiu, cai no mesmo caso
  // do disco fora do ar. É o preço de não conseguir distinguir os dois.
  it("trata biblioteca de um item que esvaziou como disco fora do ar", () => {
    expect(podeRemover(0, 1)).toBe(false);
  });
});
