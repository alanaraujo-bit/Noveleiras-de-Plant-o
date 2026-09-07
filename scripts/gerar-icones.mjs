/**
 * Gera os PNGs do ícone a partir de `public/icones/icone.svg`.
 *
 * O SVG é a fonte da verdade; os PNGs existem porque Android e iOS ainda
 * pedem bitmap no manifesto e na tela de início. A versão "máscara" tem folga
 * nas bordas para sobreviver ao recorte circular do Android.
 *
 * Uso: node scripts/gerar-icones.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const PASTA = join(process.cwd(), "public", "icones");

const SAIDAS = [
  { arquivo: "icone-192.png", tamanho: 192, folga: 0 },
  { arquivo: "icone-512.png", tamanho: 512, folga: 0 },
  { arquivo: "apple-touch-icon.png", tamanho: 180, folga: 0 },
  // Maskable: 20% de folga, como pede a especificação do Android.
  { arquivo: "icone-mascara-512.png", tamanho: 512, folga: 0.2 },
];

const svg = await readFile(join(PASTA, "icone.svg"), "utf8");
const navegador = await chromium.launch();

for (const { arquivo, tamanho, folga } of SAIDAS) {
  const pagina = await navegador.newPage({
    viewport: { width: tamanho, height: tamanho },
    deviceScaleFactor: 1,
  });

  const escala = 1 - folga;
  await pagina.setContent(
    `<!doctype html><html><body style="margin:0;width:${tamanho}px;height:${tamanho}px;background:#130810;display:grid;place-items:center;overflow:hidden">
      <div style="width:${Math.round(tamanho * escala)}px;height:${Math.round(tamanho * escala)}px">${svg}</div>
    </body></html>`,
  );
  const captura = await pagina.screenshot({ omitBackground: false });
  await writeFile(join(PASTA, arquivo), captura);
  console.log(`  ${arquivo} (${tamanho}px)`);
  await pagina.close();
}

await navegador.close();
console.log("Ícones gerados.");
