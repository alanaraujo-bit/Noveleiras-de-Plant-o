/**
 * Serve a biblioteca de vídeo para o aplicativo.
 *
 * É a peça que faltava entre "o arquivo está no meu PC" e "alguém assiste na
 * internet". Roda na máquina que guarda os vídeos e entrega os bytes; o túnel
 * (Cloudflare) põe um endereço HTTPS público na frente.
 *
 * Três coisas que um servidor de vídeo precisa e um servidor de arquivos
 * comum não faz:
 *
 * 1. **Range.** Sem responder 206 a `Range:`, o player baixa o arquivo inteiro
 *    antes de tocar e arrastar a barra não funciona. É o requisito de verdade.
 * 2. **CORS.** O player roda no domínio da aplicação e busca o vídeo aqui;
 *    sem o cabeçalho, o navegador recusa.
 * 3. **Não sair da raiz.** Qualquer caminho é resolvido e conferido contra a
 *    raiz antes de abrir. `../` numa URL não pode virar leitura de disco.
 *
 *   node --env-file=.env.agente scripts/servir-midia.mjs
 *   node scripts/servir-midia.mjs --raiz="D:/Novelas" --porta=8080
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

import { caminhoDentroDaRaiz } from "../lib/media/biblioteca.ts";

function argumento(nome, padrao) {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
}

const RAIZ = resolve(
  argumento("raiz", process.env.BIBLIOTECA_RAIZ ?? process.env.AGENTE_MIDIA ?? ""),
);
const PORTA = Number(argumento("porta", process.env.MIDIA_PORTA ?? "8099"));

if (!RAIZ || RAIZ === resolve("")) {
  console.error(
    "\n  Diga onde fica a biblioteca:" +
      '\n    node scripts/servir-midia.mjs --raiz="D:/Noveleiras de Plantão"' +
      "\n  ou defina BIBLIOTECA_RAIZ no ambiente\n",
  );
  process.exit(1);
}

const TIPOS = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".vtt": "text/vtt",
  // Capas e miniaturas vivem na mesma pasta dos vídeos e saem pela mesma
  // porta. Sem o tipo certo o navegador recebe `application/octet-stream` e
  // recusa a imagem — a capa real chegaria e não apareceria.
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/**
 * Resolve a chave da URL para um caminho dentro da raiz.
 *
 * A regra mora em `lib/media/biblioteca.ts` e é testada lá, com travessia,
 * codificação e byte nulo. Uma fronteira de segurança exercitada só por
 * curl é uma fronteira que ninguém verifica de novo.
 */
function caminhoSeguro(chave) {
  return caminhoDentroDaRaiz(RAIZ, chave, { resolve, join, normalize, sep });
}

function cabecalhosComuns(resposta) {
  // O player está em outro domínio; sem isto o navegador recusa a resposta.
  resposta.setHeader("access-control-allow-origin", "*");
  resposta.setHeader("access-control-allow-headers", "range");
  resposta.setHeader("access-control-expose-headers", "content-length, content-range, accept-ranges");
  resposta.setHeader("accept-ranges", "bytes");
}

const servidor = createServer(async (requisicao, resposta) => {
  cabecalhosComuns(resposta);

  if (requisicao.method === "OPTIONS") {
    resposta.writeHead(204).end();
    return;
  }
  if (requisicao.method !== "GET" && requisicao.method !== "HEAD") {
    resposta.writeHead(405).end();
    return;
  }

  const url = new URL(requisicao.url, `http://localhost:${PORTA}`);

  // Um jeito de saber se está no ar sem pedir um vídeo.
  if (url.pathname === "/saude") {
    resposta.writeHead(200, { "content-type": "application/json" });
    resposta.end(JSON.stringify({ ok: true, raiz: RAIZ }));
    return;
  }

  const caminho = caminhoSeguro(url.pathname.replace(/^\/+/, ""));
  if (!caminho) {
    resposta.writeHead(403).end("fora da biblioteca");
    return;
  }

  let info;
  try {
    info = await stat(caminho);
    if (!info.isFile()) throw new Error("não é arquivo");
  } catch {
    resposta.writeHead(404).end("não encontrado");
    return;
  }

  const tipo = TIPOS[extname(caminho).toLowerCase()] ?? "application/octet-stream";
  const total = info.size;

  // Cache longo: a chave identifica o conteúdo, e conteúdo de vídeo não muda
  // sob a mesma chave — quando muda, muda a chave.
  resposta.setHeader("cache-control", "public, max-age=86400");
  resposta.setHeader("content-type", tipo);

  const range = requisicao.headers.range;
  if (!range) {
    resposta.writeHead(200, { "content-length": total });
    if (requisicao.method === "HEAD") return resposta.end();
    createReadStream(caminho).pipe(resposta);
    return;
  }

  // "bytes=1000-" e "bytes=1000-2000" são as formas que os players usam.
  const achado = range.match(/bytes=(\d*)-(\d*)/);
  if (!achado) {
    resposta.writeHead(416, { "content-range": `bytes */${total}` }).end();
    return;
  }

  const inicio = achado[1] ? Number(achado[1]) : 0;
  const fim = achado[2] ? Math.min(Number(achado[2]), total - 1) : total - 1;

  if (Number.isNaN(inicio) || Number.isNaN(fim) || inicio > fim || inicio >= total) {
    resposta.writeHead(416, { "content-range": `bytes */${total}` }).end();
    return;
  }

  resposta.writeHead(206, {
    "content-range": `bytes ${inicio}-${fim}/${total}`,
    "content-length": fim - inicio + 1,
  });
  if (requisicao.method === "HEAD") return resposta.end();
  createReadStream(caminho, { start: inicio, end: fim }).pipe(resposta);
});

servidor.listen(PORTA, () => {
  console.log(
    `\n  servindo ${RAIZ}` +
      `\n  em http://localhost:${PORTA}` +
      `\n  saúde: http://localhost:${PORTA}/saude` +
      "\n\n  Para expor na internet, num outro terminal:" +
      `\n    cloudflared tunnel --url http://localhost:${PORTA}` +
      "\n  e aponte MEDIA_BASE_URL para o endereço que ele imprimir.\n",
  );
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    console.log("\n  servidor de mídia encerrado\n");
    servidor.close(() => process.exit(0));
  });
}
