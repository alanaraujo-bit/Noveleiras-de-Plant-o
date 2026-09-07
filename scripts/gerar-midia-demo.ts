/**
 * Gera a mídia de demonstração em `public/media`.
 *
 * O catálogo de demonstração não tem vídeo real. Este script produz um clipe
 * vertical por episódio, usando como fundo a mesma arte que o app desenha para
 * as capas (`lib/art.ts`) — o que mantém o player coerente com o catálogo — e
 * sobrepõe título, episódio e um relógio. Com isso dá para exercitar de
 * verdade o player, o progresso, a retomada e o tempo assistido.
 *
 * Os clipes ficam versionados para que o app publicado seja assistível, mas
 * são descartáveis: quando houver vídeo real, aponte MEDIA_BASE_URL para a
 * origem definitiva e esta pasta deixa de ser consultada.
 *
 * Uso: npm run midia:demo [-- --limite=12]
 */
import { execFile } from "node:child_process";
import { mkdir, copyFile, access, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";
import ffmpegPath from "ffmpeg-static";
import { chromium, type Browser } from "playwright";

import { artSpec, renderArt } from "../lib/art.ts";

const run = promisify(execFile);
const db = new PrismaClient();

const RAIZ = join(process.cwd(), "public", "media");
const TEMPORARIOS = join(RAIZ, ".fundos");
const LARGURA = 540;
const ALTURA = 960;
const QUADROS = 8;

// Fontes do sistema: serifa para o título, sem serifa para os apoios.
const FONTE_TITULO = "C\\:/Windows/Fonts/georgia.ttf";
const FONTE_APOIO = "C\\:/Windows/Fonts/segoeui.ttf";

function escaparTexto(valor: string): string {
  return valor
    .replace(/\\/g, "")
    .replace(/:/g, "\\:")
    .replace(/'/g, "")
    .replace(/%/g, "")
    .replace(/,/g, "\\,");
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rasteriza a arte da novela no formato vertical do vídeo: o mesmo desenho das
 * capas, redimensionado para o quadro do clipe.
 */
async function gerarFundo(
  navegador: Browser,
  slug: string,
  accent: string,
): Promise<string> {
  const destino = join(TEMPORARIOS, `${slug}.png`);
  if (await existe(destino)) return destino;

  const spec = artSpec("hero", `cena/${slug}`, accent);
  const svg = renderArt({ ...spec, width: LARGURA, height: ALTURA });

  const pagina = await navegador.newPage({
    viewport: { width: LARGURA, height: ALTURA },
    deviceScaleFactor: 1,
  });
  await pagina.setContent(
    `<!doctype html><html><body style="margin:0;width:${LARGURA}px;height:${ALTURA}px;overflow:hidden">${svg}</body></html>`,
  );
  const imagem = await pagina.screenshot({ type: "png" });
  await pagina.close();

  await mkdir(TEMPORARIOS, { recursive: true });
  await writeFile(destino, imagem);
  return destino;
}

async function gerarClipe(opcoes: {
  destino: string;
  fundo: string;
  duracaoSec: number;
  novela: string;
  episodio: string;
  rotulo: string;
}) {
  const { destino, fundo, duracaoSec } = opcoes;

  const filtro = [
    // Escurece um pouco a arte para o texto branco ficar legível.
    `[0:v]scale=${LARGURA}:${ALTURA},format=yuv420p,eq=brightness=-0.04[fundo]`,
    `[fundo]drawtext=fontfile='${FONTE_APOIO}':text='NOVELEIRAS DE PLANTAO':fontcolor=0xffffff@0.55:fontsize=17:x=(w-text_w)/2:y=74:shadowcolor=0x000000@0.6:shadowx=0:shadowy=1[marca]`,
    // Aviso honesto de que é demonstração.
    `[marca]drawtext=fontfile='${FONTE_APOIO}':text='cena de demonstracao':fontcolor=0xffffff@0.4:fontsize=15:x=(w-text_w)/2:y=104[aviso]`,
    // Relógio em minutos:segundos — dá para conferir a olho o progresso, a
    // retomada e a busca no tempo.
    `[aviso]drawtext=fontfile='${FONTE_APOIO}':text='%{eif\\:floor(t/60)\\:d}\\:%{eif\\:mod(floor(t)\\,60)\\:d\\:2}':fontcolor=0xffffff@0.92:fontsize=58:x=(w-text_w)/2:y=(h-text_h)/2-30:shadowcolor=0x000000@0.55:shadowx=0:shadowy=2[relogio]`,
    // Rodapé editorial: temporada/episódio, título e novela.
    `[relogio]drawtext=fontfile='${FONTE_APOIO}':text='${escaparTexto(opcoes.rotulo)}':fontcolor=0xe9bd78:fontsize=18:x=48:y=h-201[rotulo]`,
    `[rotulo]drawtext=fontfile='${FONTE_TITULO}':text='${escaparTexto(opcoes.episodio)}':fontcolor=0xfcf3ee:fontsize=34:x=48:y=h-166:shadowcolor=0x000000@0.7:shadowx=0:shadowy=2[titulo]`,
    `[titulo]drawtext=fontfile='${FONTE_APOIO}':text='${escaparTexto(opcoes.novela)}':fontcolor=0xffffff@0.62:fontsize=19:x=48:y=h-114[saida]`,
  ].join(";");

  await mkdir(dirname(destino), { recursive: true });
  await run(
    ffmpegPath as string,
    [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-loop", "1",
      "-framerate", String(QUADROS),
      "-i", fundo,
      "-filter_complex", filtro,
      "-map", "[saida]",
      "-t", String(duracaoSec),
      "-r", String(QUADROS),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "stillimage",
      "-crf", "34",
      "-pix_fmt", "yuv420p",
      // faststart: o player começa a tocar sem baixar o arquivo inteiro.
      "-movflags", "+faststart",
      destino,
    ],
    { maxBuffer: 1024 * 1024 * 16 },
  );
}

async function main() {
  if (!ffmpegPath) throw new Error("ffmpeg-static não encontrado.");

  const limiteArg = process.argv.find((arg) => arg.startsWith("--limite="));
  const limite = limiteArg ? Number(limiteArg.split("=")[1]) : undefined;

  const episodios = await db.episode.findMany({
    orderBy: [{ novelaId: "asc" }, { number: "asc" }],
    take: limite,
    select: {
      mediaKey: true,
      number: true,
      title: true,
      durationSec: true,
      season: { select: { number: true } },
      novela: { select: { title: true, accent: true, slug: true } },
    },
  });

  console.log(`Gerando ${episodios.length} clipes de demonstração em public/media…`);
  const navegador = await chromium.launch();

  let gerados = 0;
  let copiados = 0;
  let pulados = 0;

  // Uma referência por novela: episódios de mesma duração reaproveitam a
  // codificação, o que corta bastante o tempo total.
  const referencias = new Map<string, { caminho: string; duracao: number }>();

  for (const episodio of episodios) {
    const destino = join(RAIZ, episodio.mediaKey);
    if (await existe(destino)) {
      pulados += 1;
      continue;
    }

    const referencia = referencias.get(episodio.novela.slug);
    if (referencia && referencia.duracao === episodio.durationSec) {
      await mkdir(dirname(destino), { recursive: true });
      await copyFile(referencia.caminho, destino);
      copiados += 1;
      continue;
    }

    const fundo = await gerarFundo(
      navegador,
      episodio.novela.slug,
      episodio.novela.accent,
    );

    await gerarClipe({
      destino,
      fundo,
      duracaoSec: episodio.durationSec,
      novela: episodio.novela.title,
      episodio: episodio.title,
      rotulo: `T${episodio.season.number} EP ${episodio.number}`,
    });

    gerados += 1;
    if (!referencia) {
      referencias.set(episodio.novela.slug, {
        caminho: destino,
        duracao: episodio.durationSec,
      });
    }
    if (gerados % 10 === 0) console.log(`  ${gerados} clipes gerados…`);
  }

  await navegador.close();
  await rm(TEMPORARIOS, { recursive: true, force: true });

  console.log(
    `Pronto. ${gerados} gerados, ${copiados} reaproveitados, ${pulados} já existiam.`,
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
