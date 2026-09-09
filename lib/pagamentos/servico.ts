/**
 * O que acontece quando alguém paga.
 *
 * Este módulo é o único caminho entre "o provedor disse algo" e "o banco
 * mudou". A rota de checkout e o webhook chamam as mesmas funções daqui, de
 * propósito: se houvesse dois caminhos para liberar acesso, um deles
 * inevitavelmente ficaria sem a checagem de duplicidade.
 *
 * A regra que organiza o arquivo inteiro: **nada libera conteúdo por causa do
 * que o cliente disse.** `reconciliar*` sempre parte de uma consulta
 * autenticada ao provedor. Voltar da tela de "pagamento aprovado" apenas
 * dispara uma reconciliação — não é prova de nada.
 */

import { randomUUID } from "node:crypto";

import type {
  Prisma,
  PrismaClient,
  PurchaseStatus,
  SubscriptionPlan,
} from "@prisma/client";

import {
  concederAssinatura,
  concederTitulo,
  revogarDireitos,
} from "@/lib/access/direitos";
import { db } from "@/lib/db";

import { podeUsarMock, provedorDePagamento } from "./index";
import {
  fimDoCiclo,
  planoPorCodigo,
  PRECO_AVULSO_CENTS,
  type DefinicaoDePlano,
} from "./planos";
import type {
  ConsultaPagamento,
  EstadoProvedor,
  MetodoPagamento,
} from "./provedor";

type Conexao = PrismaClient | Prisma.TransactionClient;

/** Erro de regra de negócio — vira 4xx, não 500. */
export class ErroDeCobranca extends Error {
  constructor(
    message: string,
    public readonly codigo:
      | "plano-invalido"
      | "novela-invalida"
      | "ja-possui"
      | "sem-assinatura"
      | "metodo-invalido",
  ) {
    super(message);
    this.name = "ErroDeCobranca";
  }
}

export type InicioDeCobranca = {
  attemptId: string;
  status: EstadoProvedor;
  checkoutUrl: string | null;
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
  expiraEm: Date | null;
};

// --------------------------------------------------------------- assinar

/**
 * Abre uma tentativa de assinatura.
 *
 * A tentativa nasce no banco **antes** de o provedor ser chamado. Se a
 * chamada falhar no meio, sobra uma linha `ERROR` explicando o que a pessoa
 * tentou — em vez de um buraco onde uma cobrança pode ter acontecido do lado
 * de lá sem registro do lado de cá.
 */
export async function iniciarAssinatura(entrada: {
  userId: string;
  plano: SubscriptionPlan;
  metodo: MetodoPagamento;
  urlRetorno: string;
}): Promise<InicioDeCobranca> {
  const plano = planoPorCodigo(entrada.plano);
  if (!plano.ativo || plano.precoCents <= 0) {
    throw new ErroDeCobranca("Plano indisponível.", "plano-invalido");
  }

  const usuario = await db.user.findUniqueOrThrow({
    where: { id: entrada.userId },
    select: { id: true, email: true, name: true },
  });

  const provedor = provedorDePagamento();
  const mock = podeUsarMock();

  const tentativa = await db.paymentAttempt.create({
    data: {
      userId: usuario.id,
      kind: "SUBSCRIPTION",
      status: "CREATED",
      plan: plano.code,
      amountCents: plano.precoCents,
      currency: plano.moeda,
      method: entrada.metodo === "PIX" ? "pix" : "card",
      provider: provedor.nome,
      idempotencyKey: randomUUID(),
      isDemo: mock,
    },
  });

  try {
    const resposta = await provedor.criarAssinatura({
      usuario: { id: usuario.id, email: usuario.email, nome: usuario.name },
      plano,
      metodo: entrada.metodo,
      referenciaExterna: tentativa.id,
      idempotencyKey: tentativa.idempotencyKey,
      urlRetorno: entrada.urlRetorno,
    });

    await db.paymentAttempt.update({
      where: { id: tentativa.id },
      data: {
        externalId: resposta.externalId,
        status: mapaTentativa(resposta.status),
        rawStatus: resposta.status,
        checkoutUrl: resposta.checkoutUrl,
        pixQrCode: resposta.pixQrCode,
        expiresAt: resposta.expiraEm,
        // Cobranca feita contra um comprador de teste nao e receita. `isDemo`
        // ja e o campo que o painel usa para separar faturamento real de
        // vitrine — reusa-lo evita um conceito paralelo.
        isDemo: mock || resposta.pagadorSubstituido === true,
      },
    });

    return {
      attemptId: tentativa.id,
      status: resposta.status,
      checkoutUrl: resposta.checkoutUrl,
      pixQrCode: resposta.pixQrCode,
      pixQrCodeBase64: resposta.pixQrCodeBase64,
      expiraEm: resposta.expiraEm,
    };
  } catch (erro) {
    await db.paymentAttempt.update({
      where: { id: tentativa.id },
      data: {
        status: "ERROR",
        failureMessage: erro instanceof Error ? erro.message : String(erro),
      },
    });
    throw erro;
  }
}

// ---------------------------------------------------------------- comprar

/** Preço da compra avulsa: o da obra, quando definido; senão a tabela. */
export function precoDaNovela(novela: { priceCents: number | null }): number {
  return novela.priceCents ?? PRECO_AVULSO_CENTS;
}

/**
 * Abre uma tentativa de compra avulsa.
 *
 * Recusa quando a pessoa já tem acesso permanente àquela obra — cobrar duas
 * vezes pela mesma novela é o tipo de erro que o cliente descobre antes de
 * nós.
 */
export async function iniciarCompra(entrada: {
  userId: string;
  novelaId: string;
  metodo: MetodoPagamento;
  urlRetorno: string;
}): Promise<InicioDeCobranca> {
  const [usuario, novela, jaTem] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: entrada.userId },
      select: { id: true, email: true, name: true },
    }),
    db.novela.findUnique({
      where: { id: entrada.novelaId },
      select: { id: true, slug: true, title: true, priceCents: true },
    }),
    db.entitlement.findFirst({
      where: {
        userId: entrada.userId,
        novelaId: entrada.novelaId,
        kind: "TITLE_PURCHASE",
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);

  if (!novela) {
    throw new ErroDeCobranca("Novela não encontrada.", "novela-invalida");
  }
  if (jaTem) {
    throw new ErroDeCobranca("Você já tem esta novela.", "ja-possui");
  }

  const provedor = provedorDePagamento();
  const mock = podeUsarMock();
  const valor = precoDaNovela(novela);

  // Reaproveita uma compra pendente da mesma obra em vez de abrir outra: a
  // pessoa que fechou a aba e voltou não deve gerar duas cobranças em aberto.
  const compra =
    (await db.purchase.findFirst({
      where: { userId: usuario.id, novelaId: novela.id, status: "PENDING" },
    })) ??
    (await db.purchase.create({
      data: {
        userId: usuario.id,
        novelaId: novela.id,
        status: "PENDING",
        amountCents: valor,
        provider: provedor.nome,
        idempotencyKey: randomUUID(),
        isDemo: mock,
      },
    }));

  const tentativa = await db.paymentAttempt.create({
    data: {
      userId: usuario.id,
      kind: "PURCHASE",
      status: "CREATED",
      novelaId: novela.id,
      purchaseId: compra.id,
      amountCents: valor,
      method: entrada.metodo === "PIX" ? "pix" : "card",
      provider: provedor.nome,
      idempotencyKey: randomUUID(),
      isDemo: mock,
    },
  });

  try {
    const resposta = await provedor.criarCompra({
      usuario: { id: usuario.id, email: usuario.email, nome: usuario.name },
      novela: { id: novela.id, slug: novela.slug, titulo: novela.title },
      valorCents: valor,
      metodo: entrada.metodo,
      referenciaExterna: tentativa.id,
      idempotencyKey: tentativa.idempotencyKey,
      urlRetorno: entrada.urlRetorno,
    });

    await db.$transaction([
      db.paymentAttempt.update({
        where: { id: tentativa.id },
        data: {
          externalId: resposta.externalId,
          status: mapaTentativa(resposta.status),
          rawStatus: resposta.status,
          checkoutUrl: resposta.checkoutUrl,
          pixQrCode: resposta.pixQrCode,
          expiresAt: resposta.expiraEm,
          isDemo: mock || resposta.pagadorSubstituido === true,
        },
      }),
      db.purchase.update({
        where: { id: compra.id },
        data: { isDemo: mock || resposta.pagadorSubstituido === true },
      }),
      db.purchase.update({
        where: { id: compra.id },
        data: { externalPreferenceId: resposta.externalId },
      }),
    ]);

    return {
      attemptId: tentativa.id,
      status: resposta.status,
      checkoutUrl: resposta.checkoutUrl,
      pixQrCode: resposta.pixQrCode,
      pixQrCodeBase64: resposta.pixQrCodeBase64,
      expiraEm: resposta.expiraEm,
    };
  } catch (erro) {
    await db.paymentAttempt.update({
      where: { id: tentativa.id },
      data: {
        status: "ERROR",
        failureMessage: erro instanceof Error ? erro.message : String(erro),
      },
    });
    throw erro;
  }
}

// ------------------------------------------------------------ reconciliar

export type ResultadoReconciliacao = {
  mudou: boolean;
  motivo: string;
  attemptId: string | null;
  status: EstadoProvedor;
};

/**
 * Sincroniza um pagamento do provedor com o nosso banco.
 *
 * **É esta função que libera conteúdo**, e ela é chamada sempre a partir de
 * uma consulta autenticada — nunca do corpo de um webhook nem de um retorno
 * de navegador.
 *
 * Idempotente por construção: recebe o mesmo `externalId` quantas vezes for e
 * converge para o mesmo estado. As três defesas, em camadas:
 *
 * 1. `Payment` tem única em `(provider, externalId)` — a segunda inserção não
 *    acontece;
 * 2. `concederTitulo`/`concederAssinatura` reencontram o direito existente;
 * 3. os índices únicos parciais em `Entitlement` barram a corrida que escapar
 *    das duas anteriores.
 */
export async function reconciliarPagamento(
  externalId: string,
): Promise<ResultadoReconciliacao> {
  const provedor = provedorDePagamento();
  const consulta = await provedor.consultarPagamento(externalId);

  if (!consulta) {
    return {
      mudou: false,
      motivo: "pagamento inexistente no provedor",
      attemptId: null,
      status: "UNKNOWN",
    };
  }

  return aplicarConsulta(consulta, provedor.nome);
}

async function aplicarConsulta(
  consulta: ConsultaPagamento,
  provedorNome: string,
): Promise<ResultadoReconciliacao> {
  const tentativa = await localizarTentativa(consulta, provedorNome);

  if (!tentativa) {
    return {
      mudou: false,
      motivo: "sem tentativa correspondente",
      attemptId: null,
      status: consulta.status,
    };
  }

  return db.$transaction(async (tx) => {
    await tx.paymentAttempt.update({
      where: { id: tentativa.id },
      data: {
        status: mapaTentativa(consulta.status),
        rawStatus: consulta.statusCru,
        externalId: consulta.externalId,
        method: consulta.metodo ?? tentativa.method,
        failureCode: consulta.detalheCru,
      },
    });

    switch (consulta.status) {
      case "APPROVED":
        return aprovar(tx, tentativa, consulta, provedorNome);
      case "REJECTED":
        return recusar(tx, tentativa, consulta);
      case "REFUNDED":
      case "CHARGEBACK":
        return devolver(tx, tentativa, consulta, provedorNome);
      case "CANCELED":
      case "EXPIRED":
        return cancelarPendencia(tx, tentativa, consulta);
      default:
        return {
          mudou: false,
          motivo: `estado ${consulta.status} não muda acesso`,
          attemptId: tentativa.id,
          status: consulta.status,
        };
    }
  });
}

type Tentativa = Prisma.PaymentAttemptGetPayload<object>;

/**
 * Acha a tentativa que originou o pagamento.
 *
 * Duas vias porque `external_reference` é o caminho confiável mas nem todo
 * fluxo o preserva — o Checkout Pro, por exemplo, cria um pagamento cujo id
 * é diferente do id da preferência que guardamos.
 */
async function localizarTentativa(
  consulta: ConsultaPagamento,
  provedorNome: string,
): Promise<Tentativa | null> {
  if (consulta.referenciaExterna) {
    const porReferencia = await db.paymentAttempt.findUnique({
      where: { id: consulta.referenciaExterna },
    });
    if (porReferencia) return porReferencia;
  }

  return db.paymentAttempt.findFirst({
    where: { provider: provedorNome, externalId: consulta.externalId },
  });
}

async function aprovar(
  tx: Prisma.TransactionClient,
  tentativa: Tentativa,
  consulta: ConsultaPagamento,
  provedorNome: string,
): Promise<ResultadoReconciliacao> {
  // A única em (provider, externalId) é o que torna esta função segura de
  // repetir: a segunda entrega do mesmo webhook reencontra a linha.
  const jaRegistrado = await tx.payment.findFirst({
    where: { provider: provedorNome, externalId: consulta.externalId },
  });

  const pagamento =
    jaRegistrado ??
    (await tx.payment.create({
      data: {
        userId: tentativa.userId,
        // Compra avulsa não pertence a plano nenhum. Carimbar "MONTHLY" aqui
        // faria toda venda de novela entrar no relatório como mensalidade.
        kind:
          tentativa.kind === "PURCHASE" ? "TITLE_PURCHASE" : "SUBSCRIPTION",
        plan: tentativa.kind === "PURCHASE" ? null : (tentativa.plan ?? "MONTHLY"),
        amountCents: consulta.valorCents,
        currency: consulta.moeda,
        status: "APPROVED",
        provider: provedorNome,
        externalId: consulta.externalId,
        method: consulta.metodo,
        purchaseId: tentativa.purchaseId,
        attemptId: tentativa.id,
        isDemo: tentativa.isDemo,
      },
    }));

  if (tentativa.kind === "PURCHASE" && tentativa.purchaseId) {
    const compra = await tx.purchase.findUnique({
      where: { id: tentativa.purchaseId },
    });

    if (compra && compra.status !== "PAID") {
      await tx.purchase.update({
        where: { id: compra.id },
        data: {
          status: "PAID",
          paidAt: consulta.aprovadoEm ?? new Date(),
          externalId: consulta.externalId,
          method: consulta.metodo,
        },
      });
    }

    const novelaId = compra?.novelaId ?? tentativa.novelaId;
    if (!novelaId) {
      // Sem obra não há o que liberar. Cair aqui com string vazia violaria a
      // chave estrangeira dentro da transação, e o webhook devolveria 500 —
      // provocando reentrega infinita por um dado que nenhuma retentativa
      // conserta.
      return {
        mudou: false,
        motivo: "compra sem novela associada",
        attemptId: tentativa.id,
        status: consulta.status,
      };
    }

    const novo = await concederTitulo(
      {
        userId: tentativa.userId,
        novelaId,
        purchaseId: tentativa.purchaseId,
      },
      tx,
    );

    return {
      mudou: novo || !jaRegistrado,
      motivo: novo ? "novela liberada" : "acesso já existia",
      attemptId: tentativa.id,
      status: consulta.status,
    };
  }

  // Assinatura.
  const plano = planoPorCodigo(tentativa.plan ?? "MONTHLY");
  await ativarAssinatura(tx, tentativa.userId, plano, provedorNome, {
    externalId: consulta.externalId,
    pagamentoId: pagamento.id,
  });

  return {
    mudou: !jaRegistrado,
    motivo: jaRegistrado ? "pagamento já registrado" : "assinatura ativada",
    attemptId: tentativa.id,
    status: consulta.status,
  };
}

/**
 * Liga (ou renova) a assinatura e concede o direito correspondente.
 *
 * Separado porque a renovação mensal chega por webhook sem passar por
 * `iniciarAssinatura`: é o mesmo caminho, disparado por outro evento.
 */
export async function ativarAssinatura(
  tx: Conexao,
  userId: string,
  plano: DefinicaoDePlano,
  provedorNome: string,
  refs: { externalId?: string | null; pagamentoId?: string | null } = {},
): Promise<void> {
  const agora = new Date();
  const atual = await tx.subscription.findUnique({ where: { userId } });

  // Renovar estende a partir do fim do ciclo vigente, não de hoje: quem paga
  // adiantado não pode perder os dias que ainda tinha.
  const base =
    atual?.currentPeriodEnd && atual.currentPeriodEnd > agora
      ? atual.currentPeriodEnd
      : agora;
  const fim = fimDoCiclo(plano, base);

  const assinatura = await tx.subscription.upsert({
    where: { userId },
    create: {
      userId,
      plan: plano.code,
      status: "ACTIVE",
      provider: provedorNome,
      externalId: refs.externalId ?? null,
      priceCents: plano.precoCents,
      startedAt: agora,
      currentPeriodStart: agora,
      currentPeriodEnd: fim,
      failedCharges: 0,
      graceUntil: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
    update: {
      plan: plano.code,
      status: "ACTIVE",
      provider: provedorNome,
      externalId: refs.externalId ?? atual?.externalId ?? null,
      priceCents: plano.precoCents,
      currentPeriodStart: base,
      currentPeriodEnd: fim,
      failedCharges: 0,
      graceUntil: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
  });

  await concederAssinatura(
    {
      userId,
      kind: plano.entitlementKind === "SUBSCRIPTION_ANNUAL"
        ? "SUBSCRIPTION_ANNUAL"
        : "SUBSCRIPTION_MONTHLY",
      subscriptionId: assinatura.id,
      endsAt: fim,
    },
    tx,
  );

  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: assinatura.id,
      userId,
      type: atual?.status === "ACTIVE" ? "RENEWED" : "ACTIVATED",
      fromStatus: atual?.status ?? null,
      toStatus: "ACTIVE",
      periodEnd: fim,
      payload: {
        plano: plano.code,
        pagamentoId: refs.pagamentoId ?? null,
      } as Prisma.InputJsonValue,
    },
  });
}

async function recusar(
  tx: Prisma.TransactionClient,
  tentativa: Tentativa,
  consulta: ConsultaPagamento,
): Promise<ResultadoReconciliacao> {
  if (tentativa.purchaseId) {
    await tx.purchase.updateMany({
      where: { id: tentativa.purchaseId, status: "PENDING" },
      data: {
        status: "FAILED",
        failureCode: consulta.detalheCru,
        failureMessage: consulta.statusCru,
      },
    });
  }

  if (tentativa.kind === "SUBSCRIPTION") {
    await marcarFalhaDeCobranca(tx, tentativa.userId, consulta.detalheCru);
  }

  return {
    mudou: true,
    motivo: "pagamento recusado",
    attemptId: tentativa.id,
    status: consulta.status,
  };
}

/**
 * Cobrança de assinatura falhou.
 *
 * O acesso não cai no primeiro erro: abre-se uma tolerância de três dias,
 * porque cartão recusado por limite temporário é o caso mais comum e cortar
 * na hora gera cancelamento que não precisava acontecer. Na terceira falha
 * seguida, a assinatura vai para `PAST_DUE` sem tolerância nova.
 */
const TOLERANCIA_MS = 3 * 86_400_000;
const FALHAS_ATE_CORTAR = 3;

async function marcarFalhaDeCobranca(
  tx: Prisma.TransactionClient,
  userId: string,
  detalhe: string | null,
): Promise<void> {
  const assinatura = await tx.subscription.findUnique({ where: { userId } });
  if (!assinatura) return;

  const falhas = assinatura.failedCharges + 1;
  const cortar = falhas >= FALHAS_ATE_CORTAR;

  await tx.subscription.update({
    where: { userId },
    data: {
      failedCharges: falhas,
      status: cortar ? "PAST_DUE" : assinatura.status,
      graceUntil: cortar ? null : new Date(Date.now() + TOLERANCIA_MS),
    },
  });

  if (cortar) {
    await revogarDireitos(
      { userId, subscriptionId: assinatura.id },
      "cobranca falhou tres vezes",
      tx,
    );
  }

  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: assinatura.id,
      userId,
      type: cortar ? "PAST_DUE" : "PAYMENT_FAILED",
      fromStatus: assinatura.status,
      toStatus: cortar ? "PAST_DUE" : assinatura.status,
      payload: { falhas, detalhe } as Prisma.InputJsonValue,
    },
  });
}

async function devolver(
  tx: Prisma.TransactionClient,
  tentativa: Tentativa,
  consulta: ConsultaPagamento,
  provedorNome: string,
): Promise<ResultadoReconciliacao> {
  const chargeback = consulta.status === "CHARGEBACK";

  const pagamento = await tx.payment.findFirst({
    where: { provider: provedorNome, externalId: consulta.externalId },
  });

  // A linha de reembolso é única por (provider, externalId) do reembolso; sem
  // id próprio, deriva-se do pagamento para que reentrega não duplique.
  const refExterna = `${consulta.externalId}:${chargeback ? "cb" : "rf"}`;
  const jaRegistrado = await tx.refund.findFirst({
    where: { provider: provedorNome, externalId: refExterna },
  });

  if (jaRegistrado) {
    return {
      mudou: false,
      motivo: "devolução já registrada",
      attemptId: tentativa.id,
      status: consulta.status,
    };
  }

  const valor = consulta.reembolsadoCents || consulta.valorCents;

  await tx.refund.create({
    data: {
      userId: tentativa.userId,
      kind: chargeback ? "CHARGEBACK" : "REFUND",
      status: "APPROVED",
      paymentId: pagamento?.id ?? null,
      purchaseId: tentativa.purchaseId,
      amountCents: valor,
      currency: consulta.moeda,
      provider: provedorNome,
      externalId: refExterna,
      reason: consulta.detalheCru,
      processedAt: new Date(),
    },
  });

  if (pagamento) {
    await tx.payment.update({
      where: { id: pagamento.id },
      data: {
        status: chargeback ? "CHARGEBACK" : "REFUNDED",
        refundedCents: valor,
      },
    });
  }

  if (tentativa.purchaseId) {
    await tx.purchase.update({
      where: { id: tentativa.purchaseId },
      data: {
        status: chargeback ? "CHARGEBACK" : "REFUNDED",
        refundedCents: valor,
      },
    });
    await revogarDireitos(
      { userId: tentativa.userId, purchaseId: tentativa.purchaseId },
      chargeback ? "chargeback" : "reembolso",
      tx,
    );
  } else {
    const assinatura = await tx.subscription.findUnique({
      where: { userId: tentativa.userId },
    });
    if (assinatura) {
      await tx.subscription.update({
        where: { id: assinatura.id },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      await revogarDireitos(
        { userId: tentativa.userId, subscriptionId: assinatura.id },
        chargeback ? "chargeback" : "reembolso",
        tx,
      );
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: assinatura.id,
          userId: tentativa.userId,
          type: chargeback ? "CHARGEBACK" : "REFUNDED",
          fromStatus: assinatura.status,
          toStatus: "CANCELED",
          payload: { valor } as Prisma.InputJsonValue,
        },
      });
    }
  }

  return {
    mudou: true,
    motivo: chargeback ? "chargeback aplicado" : "reembolso aplicado",
    attemptId: tentativa.id,
    status: consulta.status,
  };
}

async function cancelarPendencia(
  tx: Prisma.TransactionClient,
  tentativa: Tentativa,
  consulta: ConsultaPagamento,
): Promise<ResultadoReconciliacao> {
  if (tentativa.purchaseId) {
    // Só mexe no que ainda está pendente: uma compra já paga não pode ser
    // desfeita por um evento de expiração que chegou atrasado.
    const { count } = await tx.purchase.updateMany({
      where: { id: tentativa.purchaseId, status: "PENDING" },
      data: {
        status: consulta.status === "EXPIRED" ? "FAILED" : "CANCELED",
        canceledAt: new Date(),
      },
    });
    return {
      mudou: count > 0,
      motivo: "cobrança encerrada sem pagamento",
      attemptId: tentativa.id,
      status: consulta.status,
    };
  }

  return {
    mudou: false,
    motivo: "cobrança encerrada sem pagamento",
    attemptId: tentativa.id,
    status: consulta.status,
  };
}

// ---------------------------------------------------------- assinatura: eu

/**
 * Cancelamento pedido pela pessoa.
 *
 * Não corta o acesso na hora. Quem pagou até o dia 30 assiste até o dia 30 —
 * cortar antes seria cobrar por um serviço não entregue. A assinatura é
 * marcada para não renovar e o direito expira sozinho no fim do ciclo.
 */
export async function cancelarAssinaturaDoUsuario(
  userId: string,
): Promise<{ ativoAte: Date | null }> {
  const assinatura = await db.subscription.findUnique({ where: { userId } });
  if (!assinatura || assinatura.plan === "FREE") {
    throw new ErroDeCobranca("Não há assinatura ativa.", "sem-assinatura");
  }

  const externo = assinatura.externalPreapprovalId ?? assinatura.externalId;
  if (externo) {
    // Falhar aqui não pode impedir o cancelamento do lado de cá: a pessoa
    // pediu, e a reconciliação seguinte acerta o provedor.
    try {
      await provedorDePagamento().cancelarAssinatura(externo);
    } catch {
      // Silenciado de propósito; o evento abaixo registra o pedido.
    }
  }

  await db.$transaction([
    db.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
    }),
    db.subscriptionEvent.create({
      data: {
        subscriptionId: assinatura.id,
        userId,
        type: "CANCEL_REQUESTED",
        fromStatus: assinatura.status,
        toStatus: assinatura.status,
        periodEnd: assinatura.currentPeriodEnd,
        payload: {} as Prisma.InputJsonValue,
      },
    }),
  ]);

  return { ativoAte: assinatura.currentPeriodEnd };
}

/**
 * Fecha assinaturas cujo ciclo terminou e que não renovam.
 *
 * Roda no cron. A leitura de direitos já ignora vencidos, então isto não é
 * porta de segurança — é o que faz o banco parar de chamar de assinante quem
 * não é mais.
 */
export async function expirarAssinaturasVencidas(
  agora: Date = new Date(),
): Promise<number> {
  const vencidas = await db.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      currentPeriodEnd: { not: null, lte: agora },
      OR: [{ graceUntil: null }, { graceUntil: { lte: agora } }],
    },
    select: { id: true, userId: true, status: true },
  });

  for (const a of vencidas) {
    await db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: a.id },
        data: { status: "EXPIRED", plan: "FREE" },
      });
      await revogarDireitos(
        { userId: a.userId, subscriptionId: a.id },
        "ciclo encerrado",
        tx,
      );
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: a.id,
          userId: a.userId,
          type: "EXPIRED",
          fromStatus: a.status,
          toStatus: "EXPIRED",
          payload: {} as Prisma.InputJsonValue,
        },
      });
    });
  }

  return vencidas.length;
}

// ---------------------------------------------------------------- extrato

/** Histórico de compras da pessoa, para a tela de assinatura. */
export async function historicoDoUsuario(userId: string) {
  const [pagamentos, compras, reembolsos] = await Promise.all([
    db.payment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.purchase.findMany({
      where: { userId, status: { in: ["PAID", "REFUNDED", "CHARGEBACK"] } },
      include: { novela: { select: { slug: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.refund.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return { pagamentos, compras, reembolsos };
}

function mapaTentativa(
  status: EstadoProvedor,
): "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "ERROR" {
  switch (status) {
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "REJECTED";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
      return "PENDING";
    case "CANCELED":
      return "EXPIRED";
    case "REFUNDED":
    case "CHARGEBACK":
      return "APPROVED";
    default:
      return "PENDING";
  }
}

export type { PurchaseStatus };
