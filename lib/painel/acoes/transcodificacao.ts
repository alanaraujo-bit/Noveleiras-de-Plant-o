"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";

// Reexportado a partir de lib/media/perfis.ts: um arquivo "use server" só pode
// exportar funções assíncronas, e o objeto de perfis derrubava a tela em
// produção com "found object".
export type { PerfilDeSaida } from "@/lib/media/perfis";

/**
 * Fila de transcodificação.
 *
 * O painel enfileira; o agente executa. A separação importa: a aplicação roda
 * em função serverless com minutos de vida, e transcodificar um episódio leva
 * mais que isso. Quem tem CPU e tempo é a máquina que já guarda o arquivo.
 *
 * Um trabalho é uma **intenção durável**: enfileirar não bloqueia ninguém, e
 * se o agente cair no meio, o trabalho volta para a fila em vez de sumir.
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

function tratarErro(erro: unknown, contexto: string): ResultadoDaAcao {
  if (erro instanceof SemPermissao) {
    return { ok: false, erro: "Você não tem permissão para esta ação." };
  }
  void log.error({ channel: "ADMIN", message: `Falha em ${contexto}`, erro });
  return { ok: false, erro: "Não deu para concluir. Tente de novo." };
}

const enfileirarSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(200),
  perfil: z.enum(["720p", "480p", "hls"]),
  prioridade: z.number().int().min(0).max(100).optional(),
});

export async function enfileirarTranscodificacao(
  entrada: z.infer<typeof enfileirarSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("transcode.gerenciar");
    const dados = enfileirarSchema.parse(entrada);

    const arquivos = await db.mediaAsset.findMany({
      where: { id: { in: dados.assetIds } },
      select: {
        id: true,
        mediaKey: true,
        episodeId: true,
        serverId: true,
        state: true,
      },
    });
    if (arquivos.length === 0) {
      return { ok: false, erro: "Nenhum arquivo encontrado." };
    }

    // Transcodificar a partir de um arquivo que não abre produz um trabalho
    // que só vai falhar. Recusar aqui poupa a fila.
    const utilizaveis = arquivos.filter(
      (a) => a.state !== "MISSING" && a.state !== "BROKEN",
    );
    if (utilizaveis.length === 0) {
      return {
        ok: false,
        erro: "Os arquivos escolhidos estão ausentes ou ilegíveis — não há o que transcodificar.",
      };
    }

    // Um trabalho por arquivo e perfil. Enfileirar o mesmo duas vezes só
    // gastaria CPU para produzir o mesmo resultado.
    const jaNaFila = await db.transcodeJob.findMany({
      where: {
        assetId: { in: utilizaveis.map((a) => a.id) },
        profile: dados.perfil,
        state: { in: ["QUEUED", "RUNNING"] },
      },
      select: { assetId: true },
    });
    const pendentes = new Set(jaNaFila.map((j) => j.assetId));
    const novos = utilizaveis.filter((a) => !pendentes.has(a.id));

    if (novos.length === 0) {
      return { ok: true, mensagem: "Todos já estavam na fila para este perfil." };
    }

    await db.transcodeJob.createMany({
      data: novos.map((arquivo) => ({
        assetId: arquivo.id,
        serverId: arquivo.serverId,
        episodeId: arquivo.episodeId,
        profile: dados.perfil,
        priority: dados.prioridade ?? 0,
        inputKey: arquivo.mediaKey,
        requestedBy: operador.id,
      })),
    });

    await registrarAuditoria(operador, {
      action: "transcode.enfileirar",
      targetType: "TranscodeJob",
      targetLabel: `${novos.length} arquivo(s) · perfil ${dados.perfil}`,
      after: {
        perfil: dados.perfil,
        prioridade: dados.prioridade ?? 0,
        arquivos: novos.length,
        ignorados: arquivos.length - novos.length,
      },
      severity: "INFO",
    });

    revalidatePath("/painel/transcodificacao");
    revalidatePath("/painel/midia");

    const ignorados = arquivos.length - novos.length;
    return {
      ok: true,
      mensagem:
        `${novos.length} ${novos.length === 1 ? "trabalho enfileirado" : "trabalhos enfileirados"}` +
        (ignorados > 0 ? ` · ${ignorados} ignorado(s) por já estarem na fila ou não serem utilizáveis.` : "."),
    };
  } catch (erro) {
    return tratarErro(erro, "enfileirarTranscodificacao");
  }
}

const trabalhoSchema = z.object({
  jobId: z.string().min(1),
  motivo: z.string().trim().max(400).optional(),
});

export async function cancelarTrabalho(
  entrada: z.infer<typeof trabalhoSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("transcode.gerenciar");
    const dados = trabalhoSchema.parse(entrada);

    const antes = await db.transcodeJob.findUnique({
      where: { id: dados.jobId },
      select: { id: true, state: true, profile: true, inputKey: true },
    });
    if (!antes) return { ok: false, erro: "Trabalho não encontrado." };
    if (antes.state === "DONE") {
      return { ok: false, erro: "Este trabalho já terminou." };
    }
    if (antes.state === "CANCELED") {
      return { ok: true, mensagem: "O trabalho já estava cancelado." };
    }

    await db.transcodeJob.update({
      where: { id: dados.jobId },
      data: { state: "CANCELED", finishedAt: new Date() },
    });

    await registrarAuditoria(operador, {
      action: "transcode.cancelar",
      targetType: "TranscodeJob",
      targetId: antes.id,
      targetLabel: `${antes.profile} · ${antes.inputKey ?? ""}`,
      before: { state: antes.state },
      after: { state: "CANCELED" },
      severity: "WARNING",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/transcodificacao");
    return {
      ok: true,
      mensagem:
        antes.state === "RUNNING"
          ? "Cancelado. O agente encerra na próxima verificação de estado."
          : "Trabalho cancelado.",
    };
  } catch (erro) {
    return tratarErro(erro, "cancelarTrabalho");
  }
}

export async function reenfileirarTrabalho(
  entrada: z.infer<typeof trabalhoSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("transcode.gerenciar");
    const dados = trabalhoSchema.parse(entrada);

    const antes = await db.transcodeJob.findUnique({
      where: { id: dados.jobId },
      select: {
        id: true,
        state: true,
        profile: true,
        attempts: true,
        error: true,
        inputKey: true,
      },
    });
    if (!antes) return { ok: false, erro: "Trabalho não encontrado." };
    if (antes.state === "QUEUED" || antes.state === "RUNNING") {
      return { ok: false, erro: "Este trabalho já está na fila." };
    }

    // A contagem de tentativas não zera: um trabalho na quarta tentativa
    // continua sendo um trabalho na quarta tentativa, e é isso que diz se o
    // problema é intermitente ou permanente.
    await db.transcodeJob.update({
      where: { id: dados.jobId },
      data: {
        state: "QUEUED",
        progress: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
        etaSec: null,
        speed: null,
        fps: null,
      },
    });

    await registrarAuditoria(operador, {
      action: "transcode.reenfileirar",
      targetType: "TranscodeJob",
      targetId: antes.id,
      targetLabel: `${antes.profile} · ${antes.inputKey ?? ""}`,
      before: { state: antes.state, error: antes.error },
      after: { state: "QUEUED" },
      severity: "INFO",
      context: { tentativasAnteriores: antes.attempts },
    });

    revalidatePath("/painel/transcodificacao");
    return { ok: true, mensagem: "De volta à fila." };
  } catch (erro) {
    return tratarErro(erro, "reenfileirarTrabalho");
  }
}
