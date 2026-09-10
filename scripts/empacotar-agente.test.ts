import { describe, expect, it } from "vitest";

import { conferirAgente, conferirImportes } from "./empacotar-agente.mjs";

/**
 * O agente empacotado precisa ser o agente do repositório.
 *
 * Este teste existe por causa de uma falha real: `lib/media/biblioteca.ts`
 * ficou para trás dentro de `desktop/src-tauri/recursos/agente` sem que nada
 * acusasse, e o app de bandeja passou a rodar uma versão antiga enquanto o
 * repositório mostrava a nova. Uma deriva dessas não aparece em revisão de
 * diff nem em teste de comportamento — só aparece na máquina de casa, depois
 * de um instalador publicado.
 */
describe("agente empacotado", () => {
  it("é idêntico ao do repositório", () => {
    expect(conferirAgente()).toEqual([]);
  });

  /**
   * O outro lado da mesma falha: `servir-midia.mjs` passou a importar
   * `lib/media/assinatura.ts` para exigir link assinado, e o arquivo não
   * estava na lista do empacotamento. No repositório tudo passa; no
   * instalador o agente morre no primeiro import, longe de qualquer teste.
   */
  it("não importa nada que fique de fora do instalador", () => {
    expect(conferirImportes()).toEqual([]);
  });
});
