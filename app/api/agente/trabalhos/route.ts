import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { log } from "@/lib/painel/log";
import { CABECALHO_DO_SEGREDO, segredoConfere } from "@/lib/painel/servidor";

/**
 * Fila de transcodificação, do lado do agente.
 *
 * Três verbos numa rota só, porque são o mesmo diálogo: o agente **pega** um
 * trabalho, **reporta** progresso enquanto executa e **encerra** com sucesso ou
 * falha.
 *
 * A reivindicação é atômica por `updateMany` com filtro de estado: dois
 * agentes pedindo ao mesmo tempo, só um leva. Sem isso, o mesmo episódio seria
 * transcodificado duas vezes e as duas gravariam por cima uma da outra.
 *
 * Trabalho preso em RUNNING sem notícia volta para a fila — o agente pode ter
 * morrido no meio, e um trabalho que ninguém executa não pode ficar
 * bloqueando a fila para sempre.
 */

const ABANDONO_MS = 10 * 60_000;

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
  if (!servidor.enabled) return null;
  return servidor;
}

/** Devolve à fila o que ficou preso em execução sem dar sinal. */
async function liberarAbandonados(): Promise<number> {
  const resultado = await db.transcodeJob.updateMany({
    where: {
      state: "RUNNING",
      startedAt: { lt: new Date(Date.now() - ABANDONO_MS) },
    },
    data: { state: "QUEUED", progress: 0, startedAt: null },
  });
  return resultado.count;
}

const pegarSchema = z.object({
  acao: z.literal("pegar"),
  slug: z.string().min(1),
  perfisSuportados: z.array(z.string()).optional(),
});

const progressoSchema = z.object({
  acao: z.literal("progresso"),
  slug: z.string().min(1),
  jobId: z.string().min(1),
  progress: z.number().min(0).max(100),
  speed: z.number().positive().optional(),
  etaSec: z.number().int().nonnegative().optional(),
  fps: z.number().positive().optional(),
});

const encerrarSchema = z.object({
  acao: z.literal("encerrar"),
  slug: z.string().min(1),
  jobId: z.string().min(1),
  sucesso: z.boolean(),
  outputKey: z.string().max(500).optional(),
  outputs: z.array(z.record(z.string(), z.unknown())).optional(),
  erro: z.string().max(2000).optional(),
  gpuUsed: z.boolean().optional(),
});

const corpoSchema = z.discriminatedUnion("acao", [
  pegarSchema,
  progressoSchema,
  encerrarSchema,
]);

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

  if (dados.acao === "pegar") {
    await liberarAbandonados();

    const candidato = await db.transcodeJob.findFirst({
      where: {
        state: "QUEUED",
        ...(dados.perfisSuportados?.length
          ? { profile: { in: dados.perfisSuportados } }
          : {}),
        // Um trabalho preso a outro servidor não é deste agente.
        OR: [{ serverId: null }, { serverId: servidor.id }],
      },
      orderBy: [{ priority: "desc" }, { queuedAt: "asc" }],
      select: { id: true },
    });
    if (!candidato) return NextResponse.json({ trabalho: null });

    // A corrida é decidida aqui: quem conseguir mudar o estado, leva.
    const reivindicado = await db.transcodeJob.updateMany({
      where: { id: candidato.id, state: "QUEUED" },
      data: {
        state: "RUNNING",
        serverId: servidor.id,
        startedAt: new Date(),
        progress: 0,
        attempts: { increment: 1 },
      },
    });
    if (reivindicado.count === 0) {
      // Outro agente foi mais rápido; o próximo ciclo pega outro.
      return NextResponse.json({ trabalho: null });
    }

    const trabalho = await db.transcodeJob.findUnique({
      where: { id: candidato.id },
      select: {
        id: true,
        profile: true,
        inputKey: true,
        episodeId: true,
        attempts: true,
        asset: { select: { path: true, mediaKey: true } },
      },
    });

    return NextResponse.json({
      trabalho: {
        id: trabalho!.id,
        perfil: trabalho!.profile,
        entradaKey: trabalho!.inputKey ?? trabalho!.asset?.mediaKey ?? null,
        entradaCaminho: trabalho!.asset?.path ?? null,
        episodioId: trabalho!.episodeId,
        tentativa: trabalho!.attempts,
      },
    });
  }

  if (dados.acao === "progresso") {
    // Se o trabalho foi cancelado no painel, a resposta avisa o agente — é
    // assim que um cancelamento alcança um processo que já está rodando.
    const atual = await db.transcodeJob.findFirst({
      where: { id: dados.jobId, serverId: servidor.id },
      select: { state: true },
    });
    if (!atual) {
      return NextResponse.json({ erro: "Trabalho não é seu" }, { status: 404 });
    }
    if (atual.state !== "RUNNING") {
      return NextResponse.json({ continuar: false, estado: atual.state });
    }

    await db.transcodeJob.update({
      where: { id: dados.jobId },
      data: {
        progress: dados.progress,
        speed: dados.speed ?? null,
        etaSec: dados.etaSec ?? null,
        fps: dados.fps ?? null,
      },
    });
    return NextResponse.json({ continuar: true });
  }

  // encerrar
  const atual = await db.transcodeJob.findFirst({
    where: { id: dados.jobId, serverId: servidor.id },
    select: { id: true, state: true, profile: true, inputKey: true },
  });
  if (!atual) {
    return NextResponse.json({ erro: "Trabalho não é seu" }, { status: 404 });
  }

  await db.transcodeJob.update({
    where: { id: dados.jobId },
    data: {
      state: dados.sucesso ? "DONE" : "FAILED",
      progress: dados.sucesso ? 100 : undefined,
      finishedAt: new Date(),
      outputKey: dados.outputKey ?? null,
      outputs: (dados.outputs ?? []) as never,
      error: dados.sucesso ? null : (dados.erro ?? "falha sem mensagem"),
      gpuUsed: dados.gpuUsed ?? false,
      etaSec: null,
    },
  });

  if (!dados.sucesso) {
    void log.error({
      channel: "JOBS",
      message: `Transcodificação falhou: ${atual.profile}`,
      entityType: "TranscodeJob",
      entityId: atual.id,
      context: { entrada: atual.inputKey, erro: dados.erro },
    });
  }

  return NextResponse.json({ ok: true });
}
