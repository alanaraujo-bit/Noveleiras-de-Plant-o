import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  importarArvore,
  liberarVarredurasAbandonadas,
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
 * A árvore vem inteira num envio só, e não arquivo a arquivo, porque uma
 * importação parcial é pior que nenhuma: metade de uma novela no catálogo é um
 * estado que ninguém sabe interpretar. Ou entra tudo, ou a varredura falha e a
 * anterior continua valendo.
 */

export const maxDuration = 300;

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
    const atual = await db.libraryScan.findFirst({
      where: { id: dados.scanId, serverId: servidor.id },
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
    select: { id: true, state: true, libraryId: true },
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
    data: { phase: "importando no catálogo" },
  });

  try {
    const resultado = await importarArvore(
      biblioteca,
      dados.novelas as NovelaVarrida[],
    );
    const agora = new Date();

    await db.$transaction([
      db.libraryScan.update({
        where: { id: atual.id },
        data: {
          state: "DONE",
          phase: null,
          finishedAt: agora,
          novelasCreated: resultado.novelasCriadas,
          novelasUpdated: resultado.novelasAtualizadas,
          episodesCreated: resultado.episodiosCriados,
          episodesUpdated: resultado.episodiosAtualizados,
          filesIndexed: resultado.arquivosIndexados,
          filesMissing: resultado.arquivosAusentes,
          bytesTotal: BigInt(Math.round(resultado.bytesTotal)),
          warnings: resultado.avisos as never,
          processedFiles: resultado.arquivosIndexados,
        },
      }),
      db.mediaLibrary.update({
        where: { id: biblioteca.id },
        data: {
          lastScanAt: agora,
          lastScanState: "DONE",
          lastNovelas: dados.novelas.length,
          lastEpisodes:
            resultado.episodiosCriados + resultado.episodiosAtualizados,
          lastFiles: resultado.arquivosIndexados,
          lastBytes: BigInt(Math.round(resultado.bytesTotal)),
        },
      }),
    ]);

    return NextResponse.json({ ok: true, resultado });
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
