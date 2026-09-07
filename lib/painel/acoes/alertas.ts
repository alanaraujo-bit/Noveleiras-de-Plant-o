"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { reconciliarAlertas } from "@/lib/painel/alertas";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";

/**
 * Ações sobre alertas.
 *
 * Reconhecer e resolver são coisas diferentes e é por isso que são duas ações:
 * reconhecer diz "estou olhando" e tira o alerta da fila de ninguém-viu;
 * resolver diz "acabou". Juntá-las esconderia quanto tempo um problema ficou
 * sem dono.
 *
 * Um alerta resolvido à mão que continua valendo é **reaberto** pela próxima
 * avaliação — a fila reflete a realidade, não o otimismo de quem a limpou.
 * Por isso resolver na tela não silencia nada de forma permanente.
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

const decisaoSchema = z.object({
  alertaId: z.string().min(1),
  decisao: z.enum(["ACKNOWLEDGED", "RESOLVED", "OPEN"]),
  motivo: z.string().trim().max(400).optional(),
});

export async function decidirAlerta(
  entrada: z.infer<typeof decisaoSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("alertas.gerenciar");
    const dados = decisaoSchema.parse(entrada);

    const antes = await db.alert.findUnique({
      where: { id: dados.alertaId },
      select: {
        id: true,
        kind: true,
        title: true,
        status: true,
        dedupeKey: true,
        resolvedNote: true,
      },
    });
    if (!antes) return { ok: false, erro: "Alerta não encontrado." };
    if (antes.status === dados.decisao) {
      return { ok: true, mensagem: "O alerta já estava nesse estado." };
    }

    const agora = new Date();
    const resolvendo = dados.decisao === "RESOLVED";

    await db.alert.update({
      where: { id: dados.alertaId },
      data: {
        status: dados.decisao,
        acknowledgedAt: dados.decisao === "ACKNOWLEDGED" ? agora : null,
        acknowledgedBy: dados.decisao === "ACKNOWLEDGED" ? operador.id : null,
        resolvedAt: resolvendo ? agora : null,
        resolvedBy: resolvendo ? operador.id : null,
        resolvedNote: resolvendo ? (dados.motivo ?? null) : null,
      },
    });

    await registrarAuditoria(operador, {
      action: `alertas.${dados.decisao.toLowerCase()}`,
      targetType: "Alert",
      targetId: antes.id,
      targetLabel: `${antes.kind} · ${antes.title}`,
      before: { status: antes.status },
      after: { status: dados.decisao },
      severity: "INFO",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/alertas");

    const mensagens: Record<string, string> = {
      ACKNOWLEDGED: "Alerta reconhecido — a equipe sabe que alguém está olhando.",
      RESOLVED:
        "Alerta resolvido. Se a condição ainda valer, a próxima avaliação o reabre.",
      OPEN: "Alerta devolvido para a fila.",
    };
    return { ok: true, mensagem: mensagens[dados.decisao] };
  } catch (erro) {
    return tratarErro(erro, "decidirAlerta");
  }
}

/** Roda as regras agora, sem esperar o próximo batimento ou o cron. */
export async function reavaliarAlertas(): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("alertas.gerenciar");
    const resultado = await reconciliarAlertas();

    await registrarAuditoria(operador, {
      action: "alertas.reavaliar",
      targetType: "Alert",
      after: resultado,
      severity: "INFO",
    });

    revalidatePath("/painel/alertas");

    if (resultado.erros.length > 0) {
      return {
        ok: false,
        erro: `Algumas regras falharam: ${resultado.erros.join("; ")}`,
      };
    }
    return {
      ok: true,
      mensagem:
        resultado.abertos === 0 && resultado.resolvidos === 0
          ? "Nada mudou — a fila já refletia a realidade."
          : `${resultado.abertos} aberto(s), ${resultado.resolvidos} resolvido(s) automaticamente.`,
    };
  } catch (erro) {
    return tratarErro(erro, "reavaliarAlertas");
  }
}
