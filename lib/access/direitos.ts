/**
 * Carrega e concede direitos de acesso.
 *
 * A separação em relação a `entitlements.ts` é deliberada: lá mora a regra
 * (pura, testável sem banco), aqui mora a persistência. Nenhuma função deste
 * arquivo decide se alguém pode assistir — elas só materializam no banco o
 * que a camada comercial concluiu.
 *
 * Conceder é sempre idempotente. Isso não é zelo: webhook reentregue,
 * usuário com dois cliques e job de reconciliação rodando junto são o caso
 * normal, não a exceção. Os índices únicos parciais criados na migration
 * `20260909050000_monetizacao` são a rede final — o código tenta acertar, o
 * banco garante.
 */

import type {
  EntitlementKind,
  EntitlementSource,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { db } from "@/lib/db";

import type { Direito, Entitlement } from "./entitlements";
import { carteiraDe } from "./entitlements";

/** Aceita a conexão normal ou uma transação, para uso dentro de `$transaction`. */
type Conexao = PrismaClient | Prisma.TransactionClient;

/**
 * Direitos vigentes de uma pessoa.
 *
 * Filtra por data no próprio SQL: uma linha `ACTIVE` já vencida (porque o job
 * de expiração ainda não passou) não pode voltar daqui como direito válido.
 */
export async function direitosDe(
  userId: string,
  conexao: Conexao = db,
  agora: Date = new Date(),
): Promise<Direito[]> {
  const linhas = await conexao.entitlement.findMany({
    where: {
      userId,
      status: "ACTIVE",
      startsAt: { lte: agora },
      OR: [{ endsAt: null }, { endsAt: { gt: agora } }],
    },
    select: { kind: true, novelaId: true, startsAt: true, endsAt: true },
  });

  return linhas.map((l) => ({
    kind: l.kind,
    novelaId: l.novelaId,
    startsAt: l.startsAt,
    endsAt: l.endsAt,
  }));
}

/** Carteira completa: assinatura + direitos, prontos para decidir acesso. */
export async function carteiraDoUsuario(
  userId: string,
  conexao: Conexao = db,
): Promise<Entitlement> {
  const [assinatura, direitos] = await Promise.all([
    conexao.subscription.findUnique({ where: { userId } }),
    direitosDe(userId, conexao),
  ]);

  return carteiraDe(assinatura, direitos);
}

export type ConcessaoAssinatura = {
  userId: string;
  kind: Extract<
    EntitlementKind,
    "SUBSCRIPTION_MONTHLY" | "SUBSCRIPTION_ANNUAL"
  >;
  subscriptionId: string;
  /** Fim do ciclo pago. Sempre existe — assinatura não é perpétua. */
  endsAt: Date;
  source?: EntitlementSource;
  reason?: string;
};

/**
 * Concede (ou estende) o direito de assinatura.
 *
 * Uma renovação **estende a linha existente** em vez de criar outra. Duas
 * linhas ativas de assinatura para a mesma pessoa são impossíveis — o índice
 * `Entitlement_assinatura_ativa_por_usuario` recusa —, e é isso que impede
 * que um webhook duplicado vire dois meses de acesso.
 *
 * Trocar de plano (mensal → anual) revoga o direito anterior na mesma
 * transação, pelo mesmo motivo.
 */
export async function concederAssinatura(
  dados: ConcessaoAssinatura,
  conexao: Conexao = db,
): Promise<void> {
  const agora = new Date();

  const atual = await conexao.entitlement.findFirst({
    where: { userId: dados.userId, novelaId: null, status: "ACTIVE" },
  });

  if (atual) {
    if (atual.kind === dados.kind) {
      // Renovação: nunca encurta o acesso. Um webhook fora de ordem, chegando
      // com um período anterior, não pode roubar dias já pagos.
      const fim =
        atual.endsAt && atual.endsAt > dados.endsAt ? atual.endsAt : dados.endsAt;

      await conexao.entitlement.update({
        where: { id: atual.id },
        data: { endsAt: fim, subscriptionId: dados.subscriptionId },
      });
      return;
    }

    await conexao.entitlement.update({
      where: { id: atual.id },
      data: {
        status: "REVOKED",
        revokedAt: agora,
        reason: dados.reason ?? "troca de plano",
      },
    });
  }

  await conexao.entitlement.create({
    data: {
      userId: dados.userId,
      kind: dados.kind,
      status: "ACTIVE",
      source: dados.source ?? "SUBSCRIPTION",
      subscriptionId: dados.subscriptionId,
      startsAt: agora,
      endsAt: dados.endsAt,
      reason: dados.reason,
    },
  });
}

export type ConcessaoTitulo = {
  userId: string;
  novelaId: string;
  purchaseId?: string | null;
  source?: EntitlementSource;
  reason?: string;
};

/**
 * Concede a compra avulsa de uma novela. Perpétua: `endsAt` fica nulo.
 *
 * Retorna `true` só quando criou algo novo — o webhook usa isso para não
 * registrar duas vezes o mesmo desbloqueio na auditoria.
 */
export async function concederTitulo(
  dados: ConcessaoTitulo,
  conexao: Conexao = db,
): Promise<boolean> {
  const existente = await conexao.entitlement.findFirst({
    where: {
      userId: dados.userId,
      novelaId: dados.novelaId,
      kind: "TITLE_PURCHASE",
      status: "ACTIVE",
    },
  });

  if (existente) {
    // Já tem. Só amarra à compra, se ainda não estava amarrado.
    if (dados.purchaseId && !existente.purchaseId) {
      await conexao.entitlement.update({
        where: { id: existente.id },
        data: { purchaseId: dados.purchaseId },
      });
    }
    return false;
  }

  try {
    await conexao.entitlement.create({
      data: {
        userId: dados.userId,
        novelaId: dados.novelaId,
        kind: "TITLE_PURCHASE",
        status: "ACTIVE",
        source: dados.source ?? "PURCHASE",
        purchaseId: dados.purchaseId ?? null,
        startsAt: new Date(),
        endsAt: null,
        reason: dados.reason,
      },
    });
    return true;
  } catch (erro) {
    // Corrida com outra entrega do mesmo webhook: o índice único parcial
    // barrou a segunda. O estado final é o desejado, então isto não é falha.
    if (ehViolacaoDeUnicidade(erro)) return false;
    throw erro;
  }
}

/** Revoga direitos. Usado por reembolso, chargeback e expiração. */
export async function revogarDireitos(
  filtro: {
    userId: string;
    subscriptionId?: string;
    purchaseId?: string;
    novelaId?: string;
  },
  motivo: string,
  conexao: Conexao = db,
): Promise<number> {
  const { count } = await conexao.entitlement.updateMany({
    where: {
      userId: filtro.userId,
      status: "ACTIVE",
      ...(filtro.subscriptionId ? { subscriptionId: filtro.subscriptionId } : {}),
      ...(filtro.purchaseId ? { purchaseId: filtro.purchaseId } : {}),
      ...(filtro.novelaId ? { novelaId: filtro.novelaId } : {}),
    },
    data: { status: "REVOKED", revokedAt: new Date(), reason: motivo },
  });

  return count;
}

/**
 * Marca como expirado todo direito cujo prazo passou.
 *
 * Existe porque a leitura já ignora vencidos: sem esta varredura o acesso
 * ainda estaria correto, mas o painel mostraria assinantes que não são mais
 * assinantes. É higiene de dado, não porta de segurança.
 */
export async function expirarDireitosVencidos(
  conexao: Conexao = db,
  agora: Date = new Date(),
): Promise<number> {
  const { count } = await conexao.entitlement.updateMany({
    where: { status: "ACTIVE", endsAt: { not: null, lte: agora } },
    data: { status: "EXPIRED" },
  });

  return count;
}

export function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return (
    typeof erro === "object" &&
    erro !== null &&
    "code" in erro &&
    (erro as { code?: string }).code === "P2002"
  );
}
