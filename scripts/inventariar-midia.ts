/**
 * Inventaria os arquivos de mídia.
 *
 * A tela de Mídia media a distância entre o que o catálogo **declara**
 * (`Episode.mediaKey`) e o que a camada de mídia **conhece** (`MediaAsset`).
 * Este comando é o que fecha essa distância: varre a origem, lê os metadados
 * de cada arquivo, calcula checksum e grava uma linha por arquivo.
 *
 * Três coisas que ele registra e que ninguém saberia sem varrer:
 *
 * 1. **Arquivo que sumiu.** Uma chave que o catálogo promete e o disco não tem
 *    vira `MISSING` — não some do inventário. Sumir do inventário esconderia
 *    exatamente o problema.
 * 2. **Arquivo órfão.** Existe no disco e nenhum episódio o usa. Ocupa espaço
 *    e ninguém sabia.
 * 3. **Duplicata por conteúdo.** Mesmo checksum em chaves diferentes.
 *
 * O checksum é caro; por padrão só roda em arquivo novo ou modificado. Use
 * `--rechecar` para recalcular tudo.
 *
 *   npm run midia:inventariar
 *   npm run midia:inventariar -- --raiz=D:/videos --aplicar
 *   npm run midia:inventariar -- --aplicar --rechecar
 */
import { join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import ffmpegPath from "ffmpeg-static";

import {
  calcularChecksum,
  estadoDoArquivo,
  sondar,
  varrer,
} from "../lib/media/inventario.ts";

const db = new PrismaClient();

function argumento(nome: string, padrao?: string): string | undefined {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
}

const APLICAR = process.argv.includes("--aplicar");
const RECHECAR = process.argv.includes("--rechecar");
const RAIZ = argumento("raiz", join(process.cwd(), "public", "media"))!;
const numero = new Intl.NumberFormat("pt-BR");

function bytes(valor: number): string {
  if (valor < 1024) return `${valor} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let n = valor / 1024;
  let i = 0;
  while (n >= 1024 && i < unidades.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${unidades[i]}`;
}

async function main() {
  if (!ffmpegPath) {
    console.error("\n  ffmpeg-static não resolveu um binário.\n");
    process.exit(1);
  }

  console.log(`\n  Varrendo ${RAIZ}\n`);
  const arquivos = await varrer(RAIZ);
  if (arquivos.length === 0) {
    console.log("  Nenhum arquivo de vídeo encontrado.\n");
    return;
  }

  const [episodios, existentes, servidor] = await Promise.all([
    db.episode.findMany({
      select: { id: true, mediaKey: true, number: true, title: true },
    }),
    db.mediaAsset.findMany({
      select: {
        id: true,
        mediaKey: true,
        variant: true,
        sizeBytes: true,
        checksum: true,
        path: true,
      },
    }),
    // Um servidor registrado marca de onde o arquivo veio. Sem ele o
    // inventário ainda vale — só não sabe dizer qual máquina o guarda.
    db.mediaServer.findFirst({ where: { enabled: true }, select: { id: true } }),
  ]);

  const porChave = new Map(episodios.map((e) => [e.mediaKey, e]));
  const jaConhecidos = new Map(
    existentes.map((a) => [`${a.mediaKey}::${a.variant}`, a]),
  );

  let novos = 0;
  let atualizados = 0;
  let quebrados = 0;
  let orfaos = 0;
  let bytesTotais = 0;
  const checksums = new Map<string, string[]>();

  for (const arquivo of arquivos) {
    const conhecido = jaConhecidos.get(`${arquivo.chave}::original`);
    const mudou =
      !conhecido || Number(conhecido.sizeBytes ?? -1) !== arquivo.tamanhoBytes;

    const sondagem = await sondar(arquivo.caminho, ffmpegPath);
    const estado = estadoDoArquivo(sondagem);
    const episodio = porChave.get(arquivo.chave);

    const checksum =
      RECHECAR || mudou || !conhecido?.checksum
        ? await calcularChecksum(arquivo.caminho)
        : conhecido.checksum;

    bytesTotais += arquivo.tamanhoBytes;
    if (estado === "BROKEN") quebrados += 1;
    if (!episodio) orfaos += 1;
    checksums.set(checksum, [...(checksums.get(checksum) ?? []), arquivo.chave]);

    const marca = !conhecido ? "+" : mudou ? "~" : " ";
    console.log(
      `  ${marca} ${arquivo.chave}` +
        `  ${bytes(arquivo.tamanhoBytes)}` +
        (sondagem.largura ? `  ${sondagem.largura}×${sondagem.altura}` : "") +
        (sondagem.duracaoSeg ? `  ${Math.round(sondagem.duracaoSeg)}s` : "") +
        (episodio ? "" : "  [órfão]") +
        (sondagem.erro ? `  [${sondagem.erro}]` : ""),
    );

    if (!conhecido) novos += 1;
    else if (mudou) atualizados += 1;

    if (!APLICAR) continue;

    const dados = {
      serverId: servidor?.id ?? null,
      provider: "LOCAL" as const,
      path: arquivo.caminho,
      episodeId: episodio?.id ?? null,
      isPrimary: true,
      sizeBytes: BigInt(arquivo.tamanhoBytes),
      durationSec: sondagem.duracaoSeg,
      width: sondagem.largura,
      height: sondagem.altura,
      codecVideo: sondagem.codecVideo,
      codecAudio: sondagem.codecAudio,
      bitrateKbps: sondagem.bitrateKbps,
      frameRate: sondagem.fps,
      container: sondagem.container,
      checksum,
      state: estado,
      stateNote: sondagem.erro,
      lastProbedAt: new Date(),
    };

    await db.mediaAsset.upsert({
      where: { mediaKey_variant: { mediaKey: arquivo.chave, variant: "original" } },
      create: { mediaKey: arquivo.chave, variant: "original", ...dados },
      update: dados,
    });
  }

  // Uma chave que o catálogo promete e a varredura não encontrou. Ela precisa
  // aparecer como MISSING; apagar a linha esconderia o problema.
  //
  // Mas só vale julgar o que pertence a esta raiz. Com duas bibliotecas — a de
  // demonstração em `public/media` e a real em outro disco — varrer uma delas
  // condenaria os arquivos da outra como sumidos, que é uma acusação falsa.
  // O critério é o caminho já gravado: um arquivo cujo `path` aponta para
  // fora desta raiz não é assunto desta varredura.
  const encontradas = new Set(arquivos.map((a) => a.chave));
  // `resolve` iguala separadores e maiúsculas de unidade; comparar as strings
  // cruas falharia entre "D:/Biblioteca" (como veio na linha de comando) e
  // "D:\Biblioteca\..." (como o Node gravou).
  const raizNormalizada = resolve(RAIZ);
  const deOutraRaiz = new Set(
    existentes
      .filter((a) => a.path && !resolve(a.path).startsWith(raizNormalizada))
      .map((a) => a.mediaKey),
  );
  const sumidas = episodios.filter(
    (e) => e.mediaKey && !encontradas.has(e.mediaKey) && !deOutraRaiz.has(e.mediaKey),
  );
  const forasteiros = episodios.filter(
    (e) => e.mediaKey && deOutraRaiz.has(e.mediaKey),
  ).length;

  if (sumidas.length > 0) {
    console.log(`\n  ${sumidas.length} chave(s) prometida(s) e não encontrada(s):`);
    for (const episodio of sumidas) {
      console.log(`  ! ${episodio.mediaKey}  (Ep. ${episodio.number} · ${episodio.title})`);
      if (!APLICAR) continue;
      await db.mediaAsset.upsert({
        where: {
          mediaKey_variant: { mediaKey: episodio.mediaKey, variant: "original" },
        },
        create: {
          mediaKey: episodio.mediaKey,
          variant: "original",
          episodeId: episodio.id,
          provider: "LOCAL",
          state: "MISSING",
          stateNote: "prometido pelo catálogo e ausente na varredura",
          lastProbedAt: new Date(),
        },
        update: {
          state: "MISSING",
          stateNote: "prometido pelo catálogo e ausente na varredura",
          lastProbedAt: new Date(),
        },
      });
    }
  }

  const duplicadas = [...checksums.entries()].filter(([, chaves]) => chaves.length > 1);
  if (duplicadas.length > 0) {
    console.log(`\n  ${duplicadas.length} conteúdo(s) duplicado(s):`);
    for (const [, chaves] of duplicadas) {
      console.log(`  = ${chaves.join("  ↔  ")}`);
      if (!APLICAR) continue;
      // O primeiro fica; os demais viram DUPLICATE. Escolher pela ordem
      // alfabética é arbitrário e estável — o que importa é que a operação
      // veja o par, não qual metade foi eleita.
      for (const chave of chaves.slice(1)) {
        await db.mediaAsset.updateMany({
          where: { mediaKey: chave, variant: "original" },
          data: {
            state: "DUPLICATE",
            stateNote: `mesmo conteúdo de ${chaves[0]}`,
          },
        });
      }
    }
  }

  console.log(
    `\n  ${arquivos.length} arquivo(s) · ${bytes(bytesTotais)}` +
      `\n  ${novos} novo(s) · ${atualizados} atualizado(s)` +
      `\n  ${quebrados} ilegível(is) · ${orfaos} órfão(s) · ${sumidas.length} sumido(s)` +
      (forasteiros > 0
        ? `\n  ${forasteiros} arquivo(s) de outra biblioteca, fora do alcance desta varredura`
        : ""),
  );
  console.log(
    APLICAR
      ? "\n  Inventário gravado.\n"
      : "\n  Nada foi gravado. Repita com --aplicar.\n",
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
