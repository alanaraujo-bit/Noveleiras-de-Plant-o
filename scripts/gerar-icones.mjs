/** Exportações da marca original. Uso: npm run icones. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
const pasta = join(process.cwd(), "public", "icones");
const original = join(process.cwd(), "public", "marca", "noveleiras-original.png");
const fundo = "#21101b";
for (const [arquivo, tamanho, escala] of [
 ["noveleiras-192.png", 192, 0.9], ["noveleiras-512.png", 512, 0.9],
 ["noveleiras-apple-180.png", 180, 0.9], ["noveleiras-maskable-512.png", 512, 0.76],
 ["noveleiras-32.png", 32, 0.9],
]) {
 const lado = Math.round(tamanho * escala);
 const simbolo = await sharp(original).resize(lado, lado).png().toBuffer();
 const composto = await sharp({ create: { width: tamanho, height: tamanho, channels: 4, background: fundo } })
  .composite([{ input: simbolo, gravity: "centre" }])
  .png().toBuffer();
 await sharp(composto).flatten({ background: fundo }).png().toFile(join(pasta, arquivo));
 console.log(arquivo + ": " + tamanho);
}
await sharp(original).resize(256, 256).webp({ quality: 92 })
 .toFile(join(process.cwd(), "public", "marca", "noveleiras-simbolo.webp"));
// ICO multirresolução reconhecido pela convenção do Next.
const imagens = await Promise.all([16, 32, 48].map((lado) =>
 sharp(join(pasta, "noveleiras-512.png")).resize(lado, lado).ensureAlpha().png().toBuffer()));
const cabecalho = Buffer.alloc(6 + imagens.length * 16);
cabecalho.writeUInt16LE(1, 2);
cabecalho.writeUInt16LE(imagens.length, 4);
let offset = cabecalho.length;
imagens.forEach((dados, i) => {
 const entrada = 6 + i * 16;
 cabecalho[entrada] = cabecalho[entrada + 1] = [16, 32, 48][i];
 cabecalho.writeUInt16LE(1, entrada + 4);
 cabecalho.writeUInt16LE(32, entrada + 6);
 cabecalho.writeUInt32LE(dados.length, entrada + 8);
 cabecalho.writeUInt32LE(offset, entrada + 12);
 offset += dados.length;
});
await writeFile(join(process.cwd(), "app", "favicon.ico"), Buffer.concat([cabecalho, ...imagens]));
// Compatibilidade com links antigos, sem manter duas identidades.
for (const [antigo, novo] of Object.entries({
 "icone-192.png": "noveleiras-192.png", "icone-512.png": "noveleiras-512.png",
 "icone-mascara-512.png": "noveleiras-maskable-512.png",
 "apple-touch-icon.png": "noveleiras-apple-180.png",
})) await writeFile(join(pasta, antigo), await readFile(join(pasta, novo)));
const png = (await readFile(join(pasta, "noveleiras-512.png"))).toString("base64");
await writeFile(join(pasta, "icone.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,' + png + '"/></svg>\n');
