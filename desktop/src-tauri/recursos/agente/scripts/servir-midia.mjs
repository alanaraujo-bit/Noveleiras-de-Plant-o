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
import { validarAssinatura } from "../lib/media/assinatura.ts";
import { ehOPrograma } from "./lib-agente.mjs";

function argumento(nome, padrao) {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
}

// Mutáveis porque este módulo passou a ter dois modos de vida: programa
// próprio, que lê a linha de comando, e peça do agente único, que recebe a
// configuração pronta em `iniciar()`. O servidor em si é o mesmo nos dois.
let RAIZ = resolve(
  argumento("raiz", process.env.BIBLIOTECA_RAIZ ?? process.env.AGENTE_MIDIA ?? ""),
);
let PORTA = Number(argumento("porta", process.env.MIDIA_PORTA ?? "8099"));

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

/**
 * Extensões que exigem link assinado.
 *
 * Só o vídeo. Capas e miniaturas saem por esta mesma porta — é por isso que
 * `.jpg` está no mapa de tipos — e aparecem no catálogo para quem sequer tem
 * conta: são material de vitrine, não o produto pago. Exigir assinatura nelas
 * deixaria a grade inteira com imagem quebrada sem proteger nada.
 */
const PROTEGIDAS = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".m3u8", ".ts"]);

/**
 * Confere o link assinado. Devolve `null` quando pode servir.
 *
 * Sem `MEDIA_SIGNING_SECRET` configurado, nada é exigido: é o modo de
 * desenvolvimento local. Os dois lados destravam juntos — o aplicativo só
 * assina quando tem o segredo, e o servidor só cobra quando tem o mesmo —, o
 * que evita o estado meio-protegido em que um exige e o outro não fornece.
 */
function conferirAssinatura(chave, url) {
  const segredo = process.env.MEDIA_SIGNING_SECRET?.trim();
  if (!segredo) return null;
  if (!PROTEGIDAS.has(extname(chave).toLowerCase())) return null;

  const resultado = validarAssinatura(
    chave,
    {
      exp: url.searchParams.get("exp"),
      u: url.searchParams.get("u"),
      sig: url.searchParams.get("sig"),
    },
    segredo,
  );

  if (resultado.valida) return null;

  // 410 para link vencido e 403 para forjado: o player distingue os dois e
  // renova o primeiro em silêncio, em vez de mostrar erro a quem tem direito.
  return resultado.motivo === "expirada"
    ? { status: 410, mensagem: "link expirado" }
    : { status: 403, mensagem: "link sem autorizacao" };
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

  const chave = url.pathname.replace(/^\/+/, "");

  const caminho = caminhoSeguro(chave);
  if (!caminho) {
    resposta.writeHead(403).end("fora da biblioteca");
    return;
  }

  // Autorização do link. Sem isto, a rota do aplicativo verificava o direito
  // de assistir e entregava uma URL permanente: quem copiasse o endereço uma
  // vez assistiria para sempre, e poderia repassá-lo.
  const negado = conferirAssinatura(chave, url);
  if (negado) {
    resposta.writeHead(negado.status).end(negado.mensagem);
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

/**
 * Sobe o servidor. Devolve uma promessa que resolve quando ele está ouvindo.
 *
 * Quem chama decide a raiz e a porta; sem argumentos, valem a linha de comando
 * e o ambiente — que é como o programa próprio funciona.
 */
export function iniciar({ raiz = RAIZ, porta = PORTA, silencioso = false } = {}) {
  RAIZ = resolve(raiz ?? "");
  PORTA = Number(porta);
  if (!RAIZ || RAIZ === resolve("")) {
    return Promise.reject(new Error("diga onde fica a biblioteca (raiz vazia)"));
  }
  return new Promise((ok, falhou) => {
    servidor.once("error", falhou);
    servidor.listen(PORTA, () => {
      servidor.off("error", falhou);
      if (!silencioso) {
        console.log(
          `\n  servindo ${RAIZ}` +
            `\n  em http://localhost:${PORTA}` +
            `\n  saúde: http://localhost:${PORTA}/saude\n`,
        );
      }
      ok(servidor);
    });
  });
}

export function parar() {
  return new Promise((ok) => servidor.close(() => ok()));
}

if (ehOPrograma(import.meta.url)) {
  if (!RAIZ || RAIZ === resolve("")) {
    console.error(
      "\n  Diga onde fica a biblioteca:" +
        '\n    node scripts/servir-midia.mjs --raiz="D:/Noveleiras de Plantão"' +
        "\n  ou defina BIBLIOTECA_RAIZ no ambiente\n",
    );
    process.exit(1);
  }
  iniciar().then(() => {
    console.log(
      "  Para expor na internet, num outro terminal:" +
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
}
