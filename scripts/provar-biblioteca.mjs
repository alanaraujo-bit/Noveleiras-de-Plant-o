/**
 * Prova do ciclo de bibliotecas.
 *
 * O ciclo só existe de verdade se as três pontas conversarem: o painel
 * declara e enfileira, o agente pega e devolve a árvore, o servidor importa.
 * Nada disso aparece num teste unitário — é diálogo entre processos.
 *
 * A prova exercita a porta real (a rota do agente, com o segredo real) e
 * confere o banco depois. Cria uma biblioteca descartável apontando para uma
 * pasta temporária, e remove tudo no fim.
 *
 *   node --env-file=.env scripts/provar-biblioteca.mjs
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import { gerarSegredo, hashDoSegredo } from "../lib/painel/servidor.ts";

const BASE = process.env.PROVA_DESTINO ?? "http://localhost:3100";
const SLUG = "prova-biblioteca";
const db = new PrismaClient();

let falhas = 0;
function checar(condicao, descricao) {
  console.log(`  ${condicao ? "✓" : "✗"} ${descricao}`);
  if (!condicao) falhas += 1;
}

async function falar(segredo, corpo) {
  const resposta = await fetch(`${BASE}/api/agente/varredura`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(segredo ? { "x-agente-segredo": segredo } : {}),
    },
    body: JSON.stringify({ slug: SLUG, ...corpo }),
  });
  return { status: resposta.status, corpo: await resposta.json().catch(() => ({})) };
}

/** Uma biblioteca de mentira, com o formato de uma de verdade. */
async function montarPasta() {
  const raiz = await mkdtemp(join(tmpdir(), "prova-biblioteca-"));
  const novela = join(raiz, "Novela de Prova");
  await mkdir(novela, { recursive: true });

  // Não precisam ser vídeos válidos: a prova é do diálogo, e um arquivo que o
  // ffmpeg recusa exercita justamente o caminho de erro.
  for (const numero of [1, 2, 4]) {
    await writeFile(
      join(novela, `Novela de Prova - E0${numero}.mp4`),
      Buffer.alloc(1024, numero),
    );
  }
  await writeFile(join(novela, "leiame.txt"), "não é vídeo");
  return raiz;
}

async function limpar(raiz, bibliotecaId) {
  if (bibliotecaId) {
    await db.libraryScan.deleteMany({ where: { libraryId: bibliotecaId } });
    await db.mediaLibrary.deleteMany({ where: { id: bibliotecaId } });
  }
  await db.mediaAsset.deleteMany({ where: { mediaKey: { startsWith: "Novela de Prova/" } } });
  await db.novela.deleteMany({ where: { slug: "novela-de-prova" } });
  await db.mediaServer.deleteMany({ where: { slug: SLUG } });
  if (raiz) await rm(raiz, { recursive: true, force: true });
}

async function main() {
  console.log("\n  Prova do ciclo de bibliotecas\n");

  const raiz = await montarPasta();
  const segredo = gerarSegredo();

  await db.mediaServer.deleteMany({ where: { slug: SLUG } });
  const servidor = await db.mediaServer.create({
    data: { slug: SLUG, name: "Agente de prova", tokenHash: hashDoSegredo(segredo) },
    select: { id: true },
  });

  let bibliotecaId = null;
  try {
    // ---- a rota exige o segredo ---------------------------------------
    checar(
      (await falar(null, { acao: "pegar" })).status === 401,
      "a fila de varredura recusa quem não tem segredo",
    );

    // ---- fila vazia não inventa trabalho -------------------------------
    const vazia = await falar(segredo, { acao: "pegar" });
    checar(
      vazia.status === 200 && vazia.corpo.varredura === null,
      "sem varredura na fila, o agente recebe null em vez de erro",
    );

    // ---- o painel declara a biblioteca e enfileira ---------------------
    const biblioteca = await db.mediaLibrary.create({
      data: { name: "Biblioteca de prova", path: raiz, autoImport: true },
      select: { id: true },
    });
    bibliotecaId = biblioteca.id;

    const scan = await db.libraryScan.create({
      data: { libraryId: biblioteca.id, phase: "aguardando o agente" },
      select: { id: true },
    });

    // ---- reivindicação atômica -----------------------------------------
    const [a, b] = await Promise.all([
      falar(segredo, { acao: "pegar" }),
      falar(segredo, { acao: "pegar" }),
    ]);
    const levaram = [a, b].filter((r) => r.corpo?.varredura).length;
    checar(levaram === 1, `dois agentes pediram e só um levou (levaram ${levaram})`);

    const pega = (a.corpo.varredura ?? b.corpo.varredura);
    checar(pega?.biblioteca?.caminho === raiz, "o agente recebeu o caminho da pasta");

    const dono = await db.mediaLibrary.findUnique({
      where: { id: biblioteca.id },
      select: { serverId: true },
    });
    checar(
      dono?.serverId === servidor.id,
      "a biblioteca passou a pertencer ao agente que a varreu",
    );

    // ---- progresso -----------------------------------------------------
    const progresso = await falar(segredo, {
      acao: "progresso",
      scanId: scan.id,
      etapa: "lendo metadados",
      total: 3,
      processados: 1,
    });
    checar(progresso.corpo.continuar === true, "o progresso é aceito");
    const emCurso = await db.libraryScan.findUnique({
      where: { id: scan.id },
      select: { phase: true, totalFiles: true, processedFiles: true },
    });
    checar(
      emCurso?.phase === "lendo metadados" && emCurso.processedFiles === 1,
      "o painel enxerga a etapa e o progresso",
    );

    // ---- entrega e importação -------------------------------------------
    const arvore = [
      {
        titulo: "Novela de Prova",
        pasta: "Novela de Prova",
        episodios: [1, 2, 4].map((n) => ({
          numero: n,
          arquivo: `Novela de Prova - E0${n}.mp4`,
          chave: `Novela de Prova/Novela de Prova - E0${n}.mp4`,
          caminho: join(raiz, "Novela de Prova", `Novela de Prova - E0${n}.mp4`),
          tamanhoBytes: 1024,
          duracaoSeg: 120,
          largura: 540,
          altura: 960,
          codecVideo: "h264",
          codecAudio: "aac",
          bitrateKbps: 800,
          fps: 30,
          container: "mov",
          checksum: null,
          erro: null,
        })),
        lacunas: [3],
        ignorados: ["leiame.txt"],
        totalDeclarado: null,
        origem: null,
      },
    ];

    const entrega = await falar(segredo, {
      acao: "entregar",
      scanId: scan.id,
      novelas: arvore,
    });
    checar(entrega.status === 200, `a entrega foi aceita (${entrega.status})`);

    const r = entrega.corpo.resultado;
    checar(r?.novelasCriadas === 1, `criou a novela (${r?.novelasCriadas})`);
    checar(r?.episodiosCriados === 3, `criou 3 episódios (${r?.episodiosCriados})`);
    checar(r?.arquivosIndexados === 3, `indexou 3 arquivos (${r?.arquivosIndexados})`);
    checar(
      r?.avisos?.some((a) => a.includes("E03")),
      "a lacuna E03 virou aviso em vez de sumir",
    );
    checar(
      r?.avisos?.some((a) => a.includes("leiame.txt")),
      "o arquivo que não casou com o padrão virou aviso",
    );

    // ---- o catálogo de verdade ------------------------------------------
    const novela = await db.novela.findUnique({
      where: { slug: "novela-de-prova" },
      select: {
        title: true,
        synopsis: true,
        tagline: true,
        accent: true,
        _count: { select: { episodes: true, seasons: true } },
      },
    });
    checar(novela?._count.episodes === 3, "os episódios existem no catálogo");
    checar(novela?._count.seasons === 1, "uma temporada foi criada");
    checar(
      novela?.synopsis === "" && novela?.tagline === "",
      "sinopse e tagline nasceram vazias — nada foi inventado",
    );
    checar(/^#[0-9A-F]{6}$/i.test(novela?.accent ?? ""), "a cor foi derivada do título");

    const asset = await db.mediaAsset.findFirst({
      where: { mediaKey: { startsWith: "Novela de Prova/" } },
      select: { state: true, durationSec: true, episodeId: true, serverId: true },
    });
    checar(asset?.state === "READY", `o arquivo ficou pronto (${asset?.state})`);
    checar(asset?.episodeId !== null, "o arquivo foi ligado ao episódio");
    checar(asset?.serverId === servidor.id, "o arquivo sabe em qual máquina está");

    // ---- a varredura fechou com números ---------------------------------
    const fechada = await db.libraryScan.findUnique({
      where: { id: scan.id },
      select: { state: true, episodesCreated: true, filesIndexed: true },
    });
    checar(fechada?.state === "DONE", `a varredura terminou (${fechada?.state})`);
    checar(fechada?.episodesCreated === 3, "o histórico guardou o que foi criado");

    const resumo = await db.mediaLibrary.findUnique({
      where: { id: biblioteca.id },
      select: { lastScanState: true, lastEpisodes: true, lastFiles: true },
    });
    checar(
      resumo?.lastScanState === "DONE" && resumo.lastFiles === 3,
      "a biblioteca guardou o resumo da última varredura",
    );

    // ---- reimportar não duplica -----------------------------------------
    const segundo = await db.libraryScan.create({
      data: { libraryId: biblioteca.id, serverId: servidor.id, state: "RUNNING", startedAt: new Date() },
      select: { id: true },
    });
    const denovo = await falar(segredo, {
      acao: "entregar",
      scanId: segundo.id,
      novelas: arvore,
    });
    const r2 = denovo.corpo.resultado;
    checar(
      r2?.novelasCriadas === 0 && r2?.episodiosCriados === 0,
      "reimportar não criou nada de novo",
    );
    checar(
      r2?.episodiosAtualizados === 3,
      `os 3 episódios foram atualizados (${r2?.episodiosAtualizados})`,
    );
    const depois = await db.novela.findUnique({
      where: { slug: "novela-de-prova" },
      select: { _count: { select: { episodes: true } } },
    });
    checar(depois?._count.episodes === 3, "continua com 3 episódios, não 6");

    // ---- varredura alheia -----------------------------------------------
    const alheia = await db.libraryScan.create({
      data: { libraryId: biblioteca.id, serverId: null, state: "RUNNING", startedAt: new Date() },
      select: { id: true },
    });
    const recusa = await falar(segredo, {
      acao: "progresso",
      scanId: alheia.id,
      processados: 1,
    });
    checar(recusa.status === 404, "reportar progresso de varredura alheia é recusado");
  } finally {
    await limpar(raiz, bibliotecaId);
  }

  const sobrou = await db.mediaLibrary.findFirst({ where: { path: raiz } });
  checar(sobrou === null, "tudo o que a prova criou foi removido");

  console.log(
    falhas === 0
      ? "\n  O ciclo de bibliotecas está fechado.\n"
      : `\n  ${falhas} verificação(ões) falharam.\n`,
  );
  if (falhas > 0) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
