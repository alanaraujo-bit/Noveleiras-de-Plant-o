"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";

/**
 * Moderação.
 *
 * Segue o mesmo padrão das ações de conta: permissão dentro da ação, estado
 * anterior lido antes de escrever, auditoria com antes e depois.
 *
 * Duas decisões que valem para todas elas:
 *
 * 1. **Ocultar não é apagar.** `hiddenAt` some do aplicativo e permanece no
 *    banco. Moderação que destrói a evidência é moderação que ninguém pode
 *    revisar — nem o próprio moderador, seis meses depois.
 *
 * 2. **Resolver a denúncia e ocultar o conteúdo são atos separados.** Uma
 *    denúncia pode ser improcedente e o conteúdo ficar; um conteúdo pode ser
 *    ocultado sem que ninguém tenha denunciado. Juntá-los num botão só
 *    esconderia qual das duas coisas de fato aconteceu.
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

function tratarErro(erro: unknown, contexto: string): ResultadoDaAcao {
  if (erro instanceof SemPermissao) {
    return { ok: false, erro: "Você não tem permissão para esta ação." };
  }
  void log.error({
    channel: "ADMIN",
    message: `Falha em ${contexto}`,
    erro,
  });
  return { ok: false, erro: "Não deu para concluir. Tente de novo." };
}

/** Trecho curto do conteúdo, para a auditoria ficar legível sem abrir o alvo. */
function trecho(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length > 90 ? `${limpo.slice(0, 89)}…` : limpo;
}

// --------------------------------------------------------------- posts

const visibilidadeSchema = z.object({
  postId: z.string().min(1),
  ocultar: z.boolean(),
  motivo: z.string().trim().max(400).optional(),
});

export async function alterarVisibilidadeDoPost(
  entrada: z.infer<typeof visibilidadeSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("comunidade.moderar");
    const dados = visibilidadeSchema.parse(entrada);

    const antes = await db.post.findUnique({
      where: { id: dados.postId },
      select: {
        id: true,
        body: true,
        hiddenAt: true,
        user: { select: { handle: true } },
      },
    });
    if (!antes) return { ok: false, erro: "Publicação não encontrada." };

    const jaOculto = antes.hiddenAt !== null;
    if (jaOculto === dados.ocultar) {
      return {
        ok: true,
        mensagem: jaOculto
          ? "A publicação já estava oculta."
          : "A publicação já estava visível.",
      };
    }

    const agora = dados.ocultar ? new Date() : null;
    await db.post.update({
      where: { id: dados.postId },
      data: { hiddenAt: agora },
    });

    await registrarAuditoria(operador, {
      action: dados.ocultar ? "comunidade.post.ocultar" : "comunidade.post.exibir",
      targetType: "Post",
      targetId: antes.id,
      targetLabel: `@${antes.user?.handle ?? "?"}: ${trecho(antes.body)}`,
      before: { hiddenAt: antes.hiddenAt },
      after: { hiddenAt: agora },
      severity: dados.ocultar ? "WARNING" : "INFO",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/comunidade");
    revalidatePath(`/painel/comunidade/${dados.postId}`);

    return {
      ok: true,
      mensagem: dados.ocultar
        ? "Publicação oculta do aplicativo."
        : "Publicação de volta ao ar.",
    };
  } catch (erro) {
    return tratarErro(erro, "alterarVisibilidadeDoPost");
  }
}

// ---------------------------------------------------------- comentários

const comentarioSchema = z.object({
  comentarioId: z.string().min(1),
  ocultar: z.boolean(),
  motivo: z.string().trim().max(400).optional(),
});

export async function alterarVisibilidadeDoComentario(
  entrada: z.infer<typeof comentarioSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("comunidade.moderar");
    const dados = comentarioSchema.parse(entrada);

    const antes = await db.comment.findUnique({
      where: { id: dados.comentarioId },
      select: {
        id: true,
        body: true,
        hiddenAt: true,
        postId: true,
        user: { select: { handle: true } },
      },
    });
    if (!antes) return { ok: false, erro: "Comentário não encontrado." };

    const jaOculto = antes.hiddenAt !== null;
    if (jaOculto === dados.ocultar) {
      return {
        ok: true,
        mensagem: jaOculto
          ? "O comentário já estava oculto."
          : "O comentário já estava visível.",
      };
    }

    const agora = dados.ocultar ? new Date() : null;
    await db.comment.update({
      where: { id: dados.comentarioId },
      data: { hiddenAt: agora },
    });

    await registrarAuditoria(operador, {
      action: dados.ocultar
        ? "comunidade.comentario.ocultar"
        : "comunidade.comentario.exibir",
      targetType: "Comment",
      targetId: antes.id,
      targetLabel: `@${antes.user?.handle ?? "?"}: ${trecho(antes.body)}`,
      before: { hiddenAt: antes.hiddenAt },
      after: { hiddenAt: agora },
      severity: dados.ocultar ? "WARNING" : "INFO",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/comunidade");
    revalidatePath(`/painel/comunidade/${antes.postId}`);

    return {
      ok: true,
      mensagem: dados.ocultar ? "Comentário oculto." : "Comentário de volta ao ar.",
    };
  } catch (erro) {
    return tratarErro(erro, "alterarVisibilidadeDoComentario");
  }
}

// ------------------------------------------------------------ denúncias

const denunciaSchema = z.object({
  denunciaId: z.string().min(1),
  estado: z.enum(["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"]),
  motivo: z.string().trim().max(400).optional(),
});

export async function decidirDenuncia(
  entrada: z.infer<typeof denunciaSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("comunidade.moderar");
    const dados = denunciaSchema.parse(entrada);

    const antes = await db.report.findUnique({
      where: { id: dados.denunciaId },
      select: {
        id: true,
        state: true,
        reason: true,
        targetType: true,
        targetId: true,
        resolvedAt: true,
        resolution: true,
      },
    });
    if (!antes) return { ok: false, erro: "Denúncia não encontrada." };

    if (antes.state === dados.estado) {
      return { ok: true, mensagem: "A denúncia já estava nesse estado." };
    }

    // Só um desfecho carimba data e autor. Voltar para OPEN ou REVIEWING é
    // reabrir a discussão, e uma denúncia reaberta não pode continuar dizendo
    // que foi resolvida às 14h32 por alguém.
    const finalizada = dados.estado === "RESOLVED" || dados.estado === "DISMISSED";

    await db.report.update({
      where: { id: dados.denunciaId },
      data: {
        state: dados.estado,
        resolvedAt: finalizada ? new Date() : null,
        resolvedBy: finalizada ? operador.id : null,
        resolution: finalizada ? (dados.motivo ?? null) : null,
      },
    });

    await registrarAuditoria(operador, {
      action: `comunidade.denuncia.${dados.estado.toLowerCase()}`,
      targetType: "Report",
      targetId: antes.id,
      targetLabel: `${antes.targetType} ${antes.targetId} · ${antes.reason}`,
      before: { state: antes.state, resolution: antes.resolution },
      after: { state: dados.estado, resolution: dados.motivo ?? null },
      severity: dados.estado === "DISMISSED" ? "WARNING" : "INFO",
    });

    revalidatePath("/painel/comunidade");

    const mensagens: Record<string, string> = {
      OPEN: "Denúncia reaberta.",
      REVIEWING: "Denúncia marcada como em análise.",
      RESOLVED: "Denúncia resolvida.",
      DISMISSED: "Denúncia arquivada como improcedente.",
    };
    return { ok: true, mensagem: mensagens[dados.estado] };
  } catch (erro) {
    return tratarErro(erro, "decidirDenuncia");
  }
}
