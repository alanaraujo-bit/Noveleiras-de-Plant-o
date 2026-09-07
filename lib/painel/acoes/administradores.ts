"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";
import {
  PERFIS,
  PERMISSOES,
  permissoesEfetivas,
  type Permissao,
} from "@/lib/painel/permissoes";

/**
 * Conceder e revogar acesso ao painel.
 *
 * É a ação mais perigosa do sistema: quem consegue chamá-la consegue dar a si
 * mesmo qualquer outra. Por isso, além do padrão de sempre (permissão dentro
 * da ação, estado anterior, auditoria), há três travas específicas:
 *
 * 1. **Ninguém edita o próprio acesso.** Nem para ampliar, nem para reduzir.
 *    Concessão é ato de outra pessoa, sempre — é o que torna a trilha de
 *    auditoria uma prova e não um bilhete que a pessoa escreveu para si.
 *
 * 2. **O último ADMIN ativo não cai.** Rebaixar o único administrador tranca
 *    a operação inteira para fora, e a única saída seria `npm run admin` com
 *    acesso ao banco. A trava é aqui, não na tela.
 *
 * 3. **Toda ação é CRITICAL na auditoria.** Mudança de acesso nunca é rotina.
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

const permissaoValida = z.string().refine((valor) => valor in PERMISSOES, {
  message: "Permissão desconhecida",
});

// ------------------------------------------------------- conceder acesso

const concederSchema = z.object({
  userId: z.string().min(1),
  papel: z.enum(["EDITOR", "ADMIN"]),
  perfil: z.string().optional(),
  permissoes: z.array(permissaoValida).optional(),
  motivo: z.string().trim().max(400).optional(),
});

export async function concederAcesso(
  entrada: z.infer<typeof concederSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("admins.gerenciar");
    const dados = concederSchema.parse(entrada);

    if (dados.userId === operador.id) {
      return { ok: false, erro: "Você não pode alterar o próprio acesso." };
    }

    const antes = await db.user.findUnique({
      where: { id: dados.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        permissions: true,
      },
    });
    if (!antes) return { ok: false, erro: "Conta não encontrada." };
    if (antes.status === "DELETED") {
      return { ok: false, erro: "Esta conta foi removida." };
    }

    // O perfil é atalho: ele preenche a lista, mas quem manda é a lista.
    const doPerfil = dados.perfil ? PERFIS[dados.perfil]?.permissoes : undefined;
    const permissoes = (dados.permissoes as Permissao[] | undefined) ?? doPerfil ?? [];

    if (dados.papel === "EDITOR" && permissoes.length === 0) {
      return {
        ok: false,
        erro: "Escolha um perfil ou ao menos uma permissão para um editor.",
      };
    }

    await db.user.update({
      where: { id: dados.userId },
      data: {
        role: dados.papel,
        // ADMIN alcança tudo pela definição de `permissoesEfetivas`; gravar
        // uma lista aqui só criaria duas fontes para a mesma verdade.
        permissions: dados.papel === "ADMIN" ? [] : permissoes,
      },
    });

    await registrarAuditoria(operador, {
      action:
        antes.role === "USER"
          ? "admins.conceder"
          : "admins.alterar",
      targetType: "User",
      targetId: antes.id,
      targetLabel: `${antes.name} <${antes.email}>`,
      before: { role: antes.role, permissions: antes.permissions },
      after: { role: dados.papel, permissions: permissoes },
      severity: "CRITICAL",
      context: {
        ...(dados.motivo ? { motivo: dados.motivo } : {}),
        ...(dados.perfil ? { perfil: dados.perfil } : {}),
      },
    });

    revalidatePath("/painel/administradores");
    revalidatePath(`/painel/administradores/${dados.userId}`);

    return {
      ok: true,
      mensagem:
        antes.role === "USER"
          ? `${antes.name} agora tem acesso ao painel.`
          : `Acesso de ${antes.name} atualizado.`,
    };
  } catch (erro) {
    return tratarErro(erro, "concederAcesso");
  }
}

// -------------------------------------------------------- revogar acesso

const revogarSchema = z.object({
  userId: z.string().min(1),
  motivo: z.string().trim().max(400).optional(),
});

export async function revogarAcesso(
  entrada: z.infer<typeof revogarSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("admins.gerenciar");
    const dados = revogarSchema.parse(entrada);

    if (dados.userId === operador.id) {
      return {
        ok: false,
        erro: "Você não pode revogar o próprio acesso — peça a outra pessoa.",
      };
    }

    const antes = await db.user.findUnique({
      where: { id: dados.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        permissions: true,
      },
    });
    if (!antes) return { ok: false, erro: "Conta não encontrada." };
    if (antes.role === "USER") {
      return { ok: true, mensagem: "Esta conta já não tinha acesso ao painel." };
    }

    if (antes.role === "ADMIN" && antes.status === "ACTIVE") {
      const ativos = await db.user.count({
        where: { role: "ADMIN", status: "ACTIVE" },
      });
      if (ativos <= 1) {
        return {
          ok: false,
          erro:
            "Este é o último administrador ativo. Promova outra pessoa antes de revogar este acesso.",
        };
      }
    }

    await db.user.update({
      where: { id: dados.userId },
      data: { role: "USER", permissions: [] },
    });

    // Sessão aberta continua valendo o cookie que já tem: sem encerrar, a
    // pessoa segue dentro do painel até o token expirar.
    await db.appSession.updateMany({
      where: { userId: dados.userId, endedAt: null },
      data: { endedAt: new Date() },
    });

    await registrarAuditoria(operador, {
      action: "admins.revogar",
      targetType: "User",
      targetId: antes.id,
      targetLabel: `${antes.name} <${antes.email}>`,
      before: { role: antes.role, permissions: antes.permissions },
      after: { role: "USER", permissions: [] },
      severity: "CRITICAL",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/administradores");

    return {
      ok: true,
      mensagem: `${antes.name} não alcança mais o painel. Sessões encerradas.`,
    };
  } catch (erro) {
    return tratarErro(erro, "revogarAcesso");
  }
}

// ---------------------------------------------------- ajustar permissões

const ajustarSchema = z.object({
  userId: z.string().min(1),
  permissoes: z.array(permissaoValida),
  motivo: z.string().trim().max(400).optional(),
});

export async function ajustarPermissoes(
  entrada: z.infer<typeof ajustarSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("admins.gerenciar");
    const dados = ajustarSchema.parse(entrada);

    if (dados.userId === operador.id) {
      return { ok: false, erro: "Você não pode alterar as próprias permissões." };
    }

    const antes = await db.user.findUnique({
      where: { id: dados.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
      },
    });
    if (!antes) return { ok: false, erro: "Conta não encontrada." };
    if (antes.role === "USER") {
      return {
        ok: false,
        erro: "Esta conta não tem acesso ao painel. Conceda o acesso primeiro.",
      };
    }
    if (antes.role === "ADMIN") {
      return {
        ok: false,
        erro:
          "Administrador alcança tudo por definição. Para limitar, mude o papel para editor.",
      };
    }
    if (dados.permissoes.length === 0) {
      return {
        ok: false,
        erro: "Um editor sem permissão nenhuma não consegue abrir nada. Revogue o acesso.",
      };
    }

    const efetivasAntes = permissoesEfetivas(antes.role, antes.permissions);

    await db.user.update({
      where: { id: dados.userId },
      data: { permissions: dados.permissoes },
    });

    await registrarAuditoria(operador, {
      action: "admins.permissoes",
      targetType: "User",
      targetId: antes.id,
      targetLabel: `${antes.name} <${antes.email}>`,
      before: { permissions: efetivasAntes },
      after: { permissions: dados.permissoes },
      severity: "CRITICAL",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/administradores");
    revalidatePath(`/painel/administradores/${dados.userId}`);

    return { ok: true, mensagem: `Permissões de ${antes.name} atualizadas.` };
  } catch (erro) {
    return tratarErro(erro, "ajustarPermissoes");
  }
}
