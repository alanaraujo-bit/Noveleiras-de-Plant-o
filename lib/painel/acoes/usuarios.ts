"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";
import { PLANOS } from "@/lib/painel/planos";

/**
 * Ações administrativas sobre contas.
 *
 * Padrão que todas seguem, sem exceção:
 *
 * 1. exigir a permissão **dentro** da ação — nunca confiar na tela que a chamou;
 * 2. ler o estado anterior antes de escrever;
 * 3. escrever;
 * 4. registrar em auditoria com antes e depois.
 *
 * O passo 2 parece burocracia e é o que permite responder "quem tirou o
 * Premium dessa pessoa e o que ela tinha antes" seis meses depois.
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

// ------------------------------------------------------- situação da conta

const statusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  motivo: z.string().trim().max(400).optional(),
});

export async function alterarSituacaoDaConta(
  entrada: z.infer<typeof statusSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("usuarios.editar");
    const dados = statusSchema.parse(entrada);

    const antes = await db.user.findUnique({
      where: { id: dados.userId },
      select: { id: true, name: true, email: true, status: true, role: true },
    });
    if (!antes) return { ok: false, erro: "Conta não encontrada." };

    if (antes.status === dados.status) {
      return { ok: true, mensagem: "A conta já estava assim." };
    }

    // Suspender a própria conta trancaria a pessoa para fora no mesmo clique.
    if (antes.id === operador.id && dados.status === "SUSPENDED") {
      return { ok: false, erro: "Você não pode suspender a própria conta." };
    }

    await db.user.update({
      where: { id: dados.userId },
      data: { status: dados.status },
    });

    // Suspensão precisa derrubar as sessões abertas, senão a pessoa continua
    // dentro do app com o cookie que já tem — a suspensão só valeria no
    // próximo login, que é justamente o que ela não vai fazer.
    if (dados.status === "SUSPENDED") {
      await db.appSession.updateMany({
        where: { userId: dados.userId, endedAt: null },
        data: { endedAt: new Date() },
      });
    }

    await registrarAuditoria(operador, {
      action:
        dados.status === "SUSPENDED"
          ? "usuarios.suspender"
          : "usuarios.reativar",
      targetType: "User",
      targetId: antes.id,
      targetLabel: `${antes.name} <${antes.email}>`,
      before: { status: antes.status },
      after: { status: dados.status },
      severity: dados.status === "SUSPENDED" ? "WARNING" : "INFO",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath(`/painel/usuarios/${dados.userId}`);
    revalidatePath("/painel/usuarios");

    return {
      ok: true,
      mensagem:
        dados.status === "SUSPENDED"
          ? "Conta suspensa e sessões encerradas."
          : "Conta reativada.",
    };
  } catch (erro) {
    return tratarErro(erro, "alterarSituacaoDaConta");
  }
}

// ---------------------------------------------------------------- plano

const planoSchema = z.object({
  userId: z.string().min(1),
  plano: z.enum(["FREE", "PREMIUM", "VIP"]),
  status: z.enum(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "EXPIRED"]),
  motivo: z.string().trim().max(400).optional(),
});

export async function alterarAssinatura(
  entrada: z.infer<typeof planoSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("financeiro.gerenciar");
    const dados = planoSchema.parse(entrada);

    const usuario = await db.user.findUnique({
      where: { id: dados.userId },
      select: { id: true, name: true, email: true, subscription: true },
    });
    if (!usuario) return { ok: false, erro: "Conta não encontrada." };

    const antes = usuario.subscription;

    // O preço é carimbado no momento da mudança. Sem isso, o MRR de amanhã
    // teria de adivinhar quanto esta assinatura vale — que é exatamente o
    // buraco que a Fase 01 deixou.
    const precoCents = PLANOS[dados.plano].precoCents;

    const depois = await db.subscription.upsert({
      where: { userId: dados.userId },
      create: {
        userId: dados.userId,
        plan: dados.plano,
        status: dados.status,
        priceCents: precoCents,
        provider: "manual",
        canceledAt: dados.status === "CANCELED" ? new Date() : null,
      },
      update: {
        plan: dados.plano,
        status: dados.status,
        priceCents: precoCents,
        provider: antes?.provider ?? "manual",
        canceledAt:
          dados.status === "CANCELED"
            ? (antes?.canceledAt ?? new Date())
            : null,
      },
    });

    await registrarAuditoria(operador, {
      action: "financeiro.assinatura.alterar",
      targetType: "User",
      targetId: usuario.id,
      targetLabel: `${usuario.name} <${usuario.email}>`,
      before: antes
        ? {
            plan: antes.plan,
            status: antes.status,
            priceCents: antes.priceCents,
          }
        : null,
      after: {
        plan: depois.plan,
        status: depois.status,
        priceCents: depois.priceCents,
      },
      severity: "WARNING",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath(`/painel/usuarios/${dados.userId}`);
    revalidatePath("/painel/financeiro");

    return { ok: true, mensagem: `Assinatura agora é ${PLANOS[dados.plano].nome}.` };
  } catch (erro) {
    return tratarErro(erro, "alterarAssinatura");
  }
}

// ------------------------------------------------------- encerrar sessões

export async function encerrarSessoesDaConta(
  userId: string,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("usuarios.editar");

    const alvo = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!alvo) return { ok: false, erro: "Conta não encontrada." };

    const resultado = await db.appSession.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: new Date() },
    });

    await registrarAuditoria(operador, {
      action: "usuarios.encerrar-sessoes",
      targetType: "User",
      targetId: userId,
      targetLabel: `${alvo.name} <${alvo.email}>`,
      after: { sessoesEncerradas: resultado.count },
      severity: "WARNING",
    });

    revalidatePath(`/painel/usuarios/${userId}`);
    return {
      ok: true,
      mensagem:
        resultado.count === 0
          ? "Não havia sessão aberta."
          : `${resultado.count} sessão(ões) encerrada(s).`,
    };
  } catch (erro) {
    return tratarErro(erro, "encerrarSessoesDaConta");
  }
}
