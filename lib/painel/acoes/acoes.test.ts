import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A regra do `"use server"`.
 *
 * Um arquivo marcado com `"use server"` só pode exportar **funções
 * assíncronas**. Cada export vira um ponto de entrada de rede, e um objeto não
 * tem como virar isso.
 *
 * Este teste existe porque `npm run build` **passa** com a violação: o
 * empacotamento local compila, e o erro só nasce em produção, quando as ações
 * viram referências de verdade. Perdi uma tela em produção por isso — a de
 * Mídia caiu inteira porque um objeto de perfis de transcodificação estava
 * exportado ao lado das ações.
 *
 * Tipos e interfaces são a exceção legítima: desaparecem na compilação e nunca
 * chegam ao empacotador.
 */

const RAIZ = join(process.cwd(), "lib", "painel", "acoes");

function arquivosDeAcao(): string[] {
  return readdirSync(RAIZ)
    .filter((nome) => nome.endsWith(".ts") && !nome.endsWith(".test.ts"))
    .map((nome) => join(RAIZ, nome));
}

/** Exports que sobrevivem à compilação e viram valor no empacotador. */
function exportsDeValor(fonte: string): string[] {
  const achados: string[] = [];

  for (const linha of fonte.split("\n")) {
    const texto = linha.trim();
    if (!texto.startsWith("export")) continue;

    // `export type`, `export interface` e `export type { … }` somem no build.
    if (/^export\s+(type|interface)\b/.test(texto)) continue;
    // Uma função assíncrona é exatamente o que este tipo de arquivo pode ter.
    if (/^export\s+async\s+function\b/.test(texto)) continue;

    const nome =
      texto.match(/^export\s+(?:const|let|var|class|enum)\s+([A-Za-z0-9_$]+)/)?.[1] ??
      texto.match(/^export\s+function\s+([A-Za-z0-9_$]+)/)?.[1] ??
      texto;
    achados.push(nome);
  }

  return achados;
}

describe('arquivos "use server"', () => {
  const arquivos = arquivosDeAcao();

  it("existem para serem testados", () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  for (const caminho of arquivos) {
    const nome = caminho.split(/[\\/]/).pop()!;
    const fonte = readFileSync(caminho, "utf8");
    const marcado = /^\s*["']use server["']/m.test(fonte);

    if (!marcado) continue;

    it(`${nome} só exporta funções assíncronas`, () => {
      const proibidos = exportsDeValor(fonte);
      expect(
        proibidos,
        `${nome} exporta valor não-assíncrono: ${proibidos.join(", ")}. ` +
          "Mova para um módulo comum — o build local passa e a tela cai em produção.",
      ).toEqual([]);
    });

    it(`${nome} exporta pelo menos uma ação`, () => {
      // Um arquivo de ações sem ação é resíduo de refatoração.
      expect(/export\s+async\s+function/.test(fonte)).toBe(true);
    });
  }
});
