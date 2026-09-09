import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  importarLote,
  liberarVarredurasAbandonadas,
  reconciliarAusentes,
  type NovelaVarrida,
} from "@/lib/painel/bibliotecas";
import { log } from "@/lib/painel/log";
import { CABECALHO_DO_SEGREDO, segredoConfere } from "@/lib/painel/servidor";

/**
 * Varredura de biblioteca, do lado do agente.
 *
 * O mesmo diálogo da fila de transcodificação, pelas mesmas razões: o agente
 * **pega** uma varredura, **reporta** progresso enquanto lê o disco e
 * **entrega** a árvore encontrada. O servidor importa e encerra.
 *
 * A árvore chega em lotes de novelas inteiras, nunca arquivo a arquivo: metade
 * de uma novela no catálogo é um estado que ninguém sabe interpretar. A novela
 * é a unidade porque a maior delas cabe folgada num envio, e a biblioteca
 * inteira não cabe — 8899 arquivos num POST só batem no teto de corpo da
 * função, e a varredura morria em 413 antes de tocar no banco.
 *
 * O último lote vem marcado, e é ele que fecha a varredura: só aí o servidor
 * sabe o que sumiu do disco, porque "ausente" é o que a varredura inteira não
 * carimbou — não o que faltou num envio.
 */

export const maxDuration = 300;

/**
 * Teto de avisos guardados na varredura.
 *
 * Cada novela pode render uma linha de lacunas e uma por arquivo ignorado; com
 * 141 novelas o texto cresce sem que ninguém o leia — o painel mostra os
 * primeiros. Guardar tudo só engorda a linha no banco.
 */
const LIMITE_DE_AVISOS = 200;

function etapaDoLote(lote?: number, total?: number) {
  return lote && total
    ? `importando no catálogo (lote ${lote}/${total})`
    : "importando no catálogo";
}

const pegarSchema = z.object({
  acao: z.literal("pegar"),
  slug: z.string().min(1),
});

const progressoSchema = z.object({
  acao: z.literal("progresso"),
  slug: z.string().min(1),
  scanId: z.string().min(1),
  etapa: z.string().max(80).optional(),
  total: z.number().int().nonnegative().optional(),
  processados: z.number().int().nonnegative().optional(),
});

const episodioSchema = z.object({
  numero: z.number().int().positive(),
  arquivo: z.string().max(500),
  chave: z.string().max(1000),
  caminho: z.string().max(1000),
  tamanhoBytes: z.number().int().nonnegative(),
  duracaoSeg: z.number().nonnegative().nullable().default(null),
  largura: z.number().int().nonnegative().nullable().default(null),
  altura: z.number().int().nonnegative().nullable().default(null),
  codecVideo: z.string().max(40).nullable().default(null),
  codecAudio: z.string().max(40).nullable().default(null),
  bitrateKbps: z.number().int().nonnegative().nullable().default(null),
  fps: z.number().nonnegative().nullable().default(null),
  container: z.string().max(40).nullable().default(null),
  checksum: z.string().max(128).nullable().default(null),
  erro: z.string().max(500).nullable().default(null),
  // Vindos do manifesto que o baixador escreve. Todos com `default`, porque um
  // agente mais antigo simplesmente não os manda — e continua funcionando.
  thumbChave: z.string().max(1000).nullable().default(null),
  estreadoEm: z.string().max(40).nullable().default(null),
  previa: z.boolean().default(false),
});

const entregarSchema = z.object({
  acao: z.literal("entregar"),
  slug: z.string().min(1),
  scanId: z.string().min(1),
  // Só para o painel mostrar andamento durante os envios.
  lote: z.number().int().positive().optional(),
  totalLotes: z.number().int().positive().optional(),
  // `true` por padrão de propósito: um agente mais antigo, que manda a árvore
  // inteira e não conhece o campo, continua fechando a varredura como sempre.
  ultimo: z.boolean().default(true),
  novelas: z
    .array(
      z.object({
        titulo: z.string().min(1).max(200),
        pasta: z.string().max(300),
        episodios: z.array(episodioSchema).max(5000),
        lacunas: z.array(z.number().int()).max(1000).default([]),
        ignorados: z.array(z.string().max(300)).max(500).default([]),
        totalDeclarado: z.number().int().nullable().default(null),
        origem: z.string().max(120).nullable().default(null),
        sinopse: z.string().max(4000).nullable().default(null),
        capaChave: z.string().max(1000).nullable().default(null),
        temas: z
          .array(
            z.object({
              chave: z.string().max(120).default(""),
              valor: z.string().max(120),
            }),
          )
          .max(30)
          .default([]),
        fonte: z.string().max(40).nullable().default(null),
        totalDuracaoSeg: z.number().nonnegative().nullable().default(null),
      }),
    )
    .max(500),
});

const falharSchema = z.object({
  acao: z.literal("falhar"),
  slug: z.string().min(1),
  scanId: z.string().min(1),
  erro: z.string().max(2000),
});

const corpoSchema = z.discriminatedUnion("acao", [
  pegarSchema,
  progressoSchema,
  entregarSchema,
  falharSchema,
]);

async function autenticar(requisicao: Request, slug: string) {
  const segredo = requisicao.headers.get(CABECALHO_DO_SEGREDO);
  if (!segredo) return null;

  const servidor = await db.mediaServer.findUnique({
    where: { slug },
    select: { id: true, tokenHash: true, enabled: true },
  });
  if (!servidor?.tokenHash || !segredoConfere(segredo, servidor.tokenHash)) {
    return null;
  }
  return servidor.enabled ? servidor : null;
}

export async function POST(requisicao: Request) {
  let bruto: unknown;
  try {
    bruto = await requisicao.json();
  } catch {
    return NextResponse.json({ erro: "Corpo inválido" }, { status: 400 });
  }

  const analise = corpoSchema.safeParse(bruto);
  if (!analise.success) {
    return NextResponse.json(
      { erro: "Requisição inválida", detalhe: analise.error.issues },
      { status: 400 },
    );
  }
  const dados = analise.data;

  const servidor = await autenticar(requisicao, dados.slug);
  if (!servidor) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  // ---- pegar -----------------------------------------------------------
  if (dados.acao === "pegar") {
    await liberarVarredurasAbandonadas();

    const candidata = await db.libraryScan.findFirst({
      where: {
        state: "QUEUED",
        library: { enabled: true },
        // Uma varredura sem servidor é de quem chegar primeiro; com servidor,
        // é só daquele agente.
        OR: [{ serverId: null }, { serverId: servidor.id }],
      },
      orderBy: { queuedAt: "asc" },
      select: { id: true },
    });
    if (!candidata) return NextResponse.json({ varredura: null });

    // A corrida é decidida aqui: quem mudar o estado, leva.
    const reivindicada = await db.libraryScan.updateMany({
      where: { id: candidata.id, state: "QUEUED" },
      data: {
        state: "RUNNING",
        serverId: servidor.id,
        startedAt: new Date(),
        phase: "varrendo a pasta",
      },
    });
    if (reivindicada.count === 0) return NextResponse.json({ varredura: null });

    const scan = await db.libraryScan.findUnique({
      where: { id: candidata.id },
      select: {
        id: true,
        full: true,
        library: { select: { id: true, name: true, path: true } },
      },
    });

    // O servidor passa a ser o dono da biblioteca a partir da primeira
    // varredura: antes disso ninguém sabia em qual máquina a pasta estava.
    await db.mediaLibrary.update({
      where: { id: scan!.library.id },
      data: { serverId: servidor.id },
    });

    return NextResponse.json({
      varredura: {
        id: scan!.id,
        completa: scan!.full,
        biblioteca: {
          id: scan!.library.id,
          nome: scan!.library.name,
          caminho: scan!.library.path,
        },
      },
    });
  }

  // ---- progresso -------------------------------------------------------
  if (dados.acao === "progresso") {
    const atual = await db.libraryScan.findFirst({
      where: { id: dados.scanId, serverId: servidor.id },
      select: { state: true },
    });
    if (!atual) {
      return NextResponse.json({ erro: "Varredura não é sua" }, { status: 404 });
    }
    // Cancelar no painel alcança um agente já lendo o disco.
    if (atual.state !== "RUNNING") {
      return NextResponse.json({ continuar: false, estado: atual.state });
    }

    await db.libraryScan.update({
      where: { id: dados.scanId },
      data: {
        phase: dados.etapa,
        totalFiles: dados.total ?? undefined,
        processedFiles: dados.processados ?? undefined,
      },
    });
    return NextResponse.json({ continuar: true });
  }

  // ---- falhar ----------------------------------------------------------
  if (dados.acao === "falhar") {
    // Só uma varredura ainda em execução pode falhar. Sem o `RUNNING`, uma
    // resposta perdida no último lote pintaria de vermelho uma varredura que
    // já terminou: o agente reenvia, leva 409 de quem já fechou, desiste e
    // relata a falha — sobre uma importação que de fato aconteceu.
    const atual = await db.libraryScan.findFirst({
      where: { id: dados.scanId, serverId: servidor.id, state: "RUNNING" },
      select: { id: true, libraryId: true },
    });
    if (!atual) {
      return NextResponse.json({ erro: "Varredura não é sua" }, { status: 404 });
    }

    await db.$transaction([
      db.libraryScan.update({
        where: { id: atual.id },
        data: { state: "FAILED", error: dados.erro, finishedAt: new Date() },
      }),
      db.mediaLibrary.update({
        where: { id: atual.libraryId },
        data: { lastScanAt: new Date(), lastScanState: "FAILED" },
      }),
    ]);

    void log.error({
      channel: "JOBS",
      message: "Varredura de biblioteca falhou",
      entityType: "LibraryScan",
      entityId: atual.id,
      context: { erro: dados.erro },
    });

    return NextResponse.json({ ok: true });
  }

  // ---- entregar --------------------------------------------------------
  const atual = await db.libraryScan.findFirst({
    where: { id: dados.scanId, serverId: servidor.id },
    select: { id: true, state: true, libraryId: true, warnings: true },
  });
  if (!atual) {
    return NextResponse.json({ erro: "Varredura não é sua" }, { status: 404 });
  }
  if (atual.state !== "RUNNING") {
    return NextResponse.json(
      { erro: `Varredura está ${atual.state}`, estado: atual.state },
      { status: 409 },
    );
  }

  const biblioteca = await db.mediaLibrary.findUnique({
    where: { id: atual.libraryId },
    select: {
      id: true,
      serverId: true,
      autoImport: true,
      publishOnImport: true,
    },
  });
  if (!biblioteca) {
    return NextResponse.json({ erro: "Biblioteca sumiu" }, { status: 410 });
  }

  await db.libraryScan.update({
    where: { id: atual.id },
    data: { phase: etapaDoLote(dados.lote, dados.totalLotes) },
  });

  try {
    // O lote entra carimbado com o id da varredura: é o carimbo que, no fim,
    // separa "não está mais no disco" de "ainda não chegou".
    const resultado = await importarLote(
      biblioteca,
      dados.novelas as NovelaVarrida[],
      atual.id,
    );

    const anteriores = Array.isArray(atual.warnings)
      ? (atual.warnings as string[])
      : [];
    const avisos = [...anteriores, ...resultado.avisos].slice(0, LIMITE_DE_AVISOS);

    // Somar, não substituir: com a árvore em lotes, o número certo é o de
    // todos eles — o último sozinho diria "60 episódios, 300 MB".
    const acumulado = await db.libraryScan.update({
      where: { id: atual.id },
      data: {
        novelasSeen: { increment: dados.novelas.length },
        novelasCreated: { increment: resultado.novelasCriadas },
        novelasUpdated: { increment: resultado.novelasAtualizadas },
        episodesCreated: { increment: resultado.episodiosCriados },
        episodesUpdated: { increment: resultado.episodiosAtualizados },
        filesIndexed: { increment: resultado.arquivosIndexados },
        bytesTotal: { increment: BigInt(Math.round(resultado.bytesTotal)) },
        warnings: avisos as never,
      },
      select: {
        novelasSeen: true,
        novelasCreated: true,
        novelasUpdated: true,
        episodesCreated: true,
        episodesUpdated: true,
        filesIndexed: true,
        bytesTotal: true,
      },
    });

    // ---- ainda vem mais ------------------------------------------------
    if (!dados.ultimo) {
      await db.libraryScan.update({
        where: { id: atual.id },
        data: { processedFiles: acumulado.filesIndexed },
      });
      return NextResponse.json({ ok: true, parcial: true, resultado });
    }

    // ---- o último fecha a varredura ------------------------------------
    await db.libraryScan.update({
      where: { id: atual.id },
      data: {
        phase: "conferindo o que sumiu",
        processedFiles: acumulado.filesIndexed,
      },
    });

    const faltantes = await reconciliarAusentes(biblioteca, atual.id);
    const avisosFinais = [...avisos, ...faltantes.avisos].slice(0, LIMITE_DE_AVISOS);
    const agora = new Date();

    await db.$transaction([
      db.libraryScan.update({
        where: { id: atual.id },
        data: {
          state: "DONE",
          phase: null,
          finishedAt: agora,
          filesMissing: faltantes.arquivosAusentes,
          warnings: avisosFinais as never,
        },
      }),
      db.mediaLibrary.update({
        where: { id: biblioteca.id },
        data: {
          lastScanAt: agora,
          lastScanState: "DONE",
          lastNovelas: acumulado.novelasSeen,
          lastEpisodes: acumulado.episodesCreated + acumulado.episodesUpdated,
          lastFiles: acumulado.filesIndexed,
          lastBytes: acumulado.bytesTotal,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      resultado: {
        ...resultado,
        ...faltantes,
        // Quem pergunta é o agente, e o que ele quer saber é o que a varredura
        // fez — não o que coube no último lote dela.
        novelasCriadas: acumulado.novelasCreated,
        novelasAtualizadas: acumulado.novelasUpdated,
        episodiosCriados: acumulado.episodesCreated,
        episodiosAtualizados: acumulado.episodesUpdated,
        arquivosIndexados: acumulado.filesIndexed,
        bytesTotal: Number(acumulado.bytesTotal),
        avisos: avisosFinais,
      },
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await db.libraryScan.update({
      where: { id: atual.id },
      data: {
        state: "FAILED",
        error: `falha ao importar: ${mensagem}`.slice(0, 2000),
        finishedAt: new Date(),
      },
    });
    void log.error({
      channel: "JOBS",
      message: "Importação de biblioteca falhou",
      erro,
      entityType: "LibraryScan",
      entityId: atual.id,
    });
    return NextResponse.json({ erro: "Falha ao importar" }, { status: 500 });
  }
}
