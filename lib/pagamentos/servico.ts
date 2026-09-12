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
  BillingMode,
  Prisma,
  PrismaClient,
  PurchaseStatus,
  SubscriptionPlan,
} from "@prisma/client";

import {
  concederAssinatura,
  concederTitulo,
  ehViolacaoDeUnicidade,
  revogarDireitos,
} from "@/lib/access/direitos";
import { db } from "@/lib/db";
import { log } from "@/lib/painel/log";

import { podeUsarMock, provedorDePagamento } from "./index";
import { CARENCIA_MANUAL_MS, fimDaCarencia, inicioDoCiclo } from "./ciclo";
import {
  fimDoCiclo,
  planoPorCodigo,
  PRECO_AVULSO_CENTS,
  type DefinicaoDePlano,
} from "./planos";
import { sanitizarFalha } from "./provedor";
import type {
  ConsultaAssinatura,
  ConsultaPagamento,
  EstadoProvedor,
  FaturaDeAssinatura,
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
      | "metodo-invalido"
      | "cancelamento-nao-confirmado"
      // Pediu Pix tendo cartão que já renova sozinho: pagar os dois é perder
      // dinheiro, e é da pessoa que ele seria.
      | "renovacao-automatica-ativa"
      // Pediu cancelamento num plano que não renova sozinho: não há o que
      // cancelar, e fingir que houve deixaria um `cancelAtPeriodEnd` mentindo.
      | "renovacao-manual",
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

/**
 * Quanto tempo um QR do Pix vale.
 *
 * Meia hora cabe numa sessão: dá tempo de abrir o aplicativo do banco, e não
 * dá tempo de a pessoa esquecer que gerou. Um QR válido por dias é pior do que
 * parece — ela volta ao aplicativo sem saber se ainda deve aquele Pix, e o
 * risco de pagar dois vira real.
 */
export const VALIDADE_DO_PIX_MINUTOS = 30;

/**
 * Abre a cobrança Pix de um mês do plano mensal.
 *
 * Não cria contrato nenhum. Nasce um pagamento, ele concede um ciclo, e
 * acabou — a próxima renovação é outra decisão da pessoa, outro Pix, outro
 * ciclo. É o que `MANUAL_RENEW` quer dizer.
 *
 * Duas recusas antes de gastar uma chamada no provedor, e as duas são sobre
 * dinheiro:
 *
 * 1. **Já existe um Pix vivo desta pessoa?** Devolve o mesmo, em vez de abrir
 *    outro. Dois toques no botão não podem virar duas cobranças em aberto — a
 *    compra avulsa já se protege assim, reaproveitando a `Purchase` pendente.
 *
 * 2. **O cartão já renova sozinho?** Então não há o que renovar à mão, e
 *    deixar passar significaria a pessoa pagando o Pix enquanto o Mercado Pago
 *    segue cobrando o cartão no fim do mês. Quem cancelou a renovação
 *    automática, ou está vencido, passa — aí o Pix é exatamente o certo.
 */
export async function iniciarAssinaturaPix(entrada: {
  userId: string;
  plano: SubscriptionPlan;
}): Promise<InicioDeCobranca> {
  const plano = planoPorCodigo(entrada.plano);

  // Só o mensal. O anual por Pix seria um ano de acesso concedido de uma vez,
  // uma decisão comercial diferente que ninguém tomou — e recusar aqui é
  // melhor que descobrir depois, com o dinheiro já recebido.
  if (plano.code !== "MONTHLY" || !plano.ativo || plano.precoCents <= 0) {
    throw new ErroDeCobranca(
      "O Pix está disponível no plano mensal.",
      "plano-invalido",
    );
  }

  const [usuario, assinatura] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: entrada.userId },
      select: { id: true, email: true, name: true },
    }),
    db.subscription.findUnique({ where: { userId: entrada.userId } }),
  ]);

  const cartaoRenovandoSozinho =
    assinatura?.billingMode === "AUTO_RENEW" &&
    assinatura.externalPreapprovalId !== null &&
    !assinatura.cancelAtPeriodEnd &&
    (assinatura.status === "ACTIVE" || assinatura.status === "TRIALING");

  if (cartaoRenovandoSozinho) {
    throw new ErroDeCobranca(
      "Sua assinatura já é renovada sozinha no cartão. " +
        "Se quiser passar a pagar por Pix, cancele a renovação automática primeiro.",
      "renovacao-automatica-ativa",
    );
  }

  const provedor = provedorDePagamento();
  const mock = podeUsarMock();
  const agora = new Date();

  // Cobrança ainda viva desta pessoa: mesmo QR, mesma tentativa. `expiresAt`
  // no futuro é a condição — uma tentativa pendente e vencida não serve de
  // nada e precisa dar lugar a outra.
  const viva = await db.paymentAttempt.findFirst({
    where: {
      userId: usuario.id,
      kind: "SUBSCRIPTION",
      billingMode: "MANUAL_RENEW",
      status: { in: ["CREATED", "PENDING"] },
      pixQrCode: { not: null },
      expiresAt: { gt: agora },
    },
    orderBy: { createdAt: "desc" },
  });

  if (viva) {
    return {
      attemptId: viva.id,
      status: "PENDING",
      checkoutUrl: null,
      pixQrCode: viva.pixQrCode,
      pixQrCodeBase64: viva.pixQrCodeBase64,
      expiraEm: viva.expiresAt,
    };
  }

  const tentativa = await db.paymentAttempt.create({
    data: {
      userId: usuario.id,
      kind: "SUBSCRIPTION",
      status: "CREATED",
      plan: plano.code,
      billingMode: "MANUAL_RENEW",
      amountCents: plano.precoCents,
      currency: plano.moeda,
      method: "pix",
      provider: provedor.nome,
      idempotencyKey: randomUUID(),
      isDemo: mock,
    },
  });

  try {
    const resposta = await provedor.criarAssinaturaPix({
      usuario: { id: usuario.id, email: usuario.email, nome: usuario.name },
      plano,
      referenciaExterna: tentativa.id,
      idempotencyKey: tentativa.idempotencyKey,
      expiraEmMinutos: VALIDADE_DO_PIX_MINUTOS,
    });

    await db.paymentAttempt.update({
      where: { id: tentativa.id },
      data: {
        // Aqui `externalId` é o **pagamento**, e é essa diferença em relação
        // ao cartão que faz a reconciliação achar o caminho certo depois.
        externalId: resposta.externalId,
        status: mapaTentativa(resposta.status),
        rawStatus: resposta.status,
        pixQrCode: resposta.pixQrCode,
        pixQrCodeBase64: resposta.pixQrCodeBase64,
        expiresAt: resposta.expiraEm,
        isDemo: mock || resposta.pagadorSubstituido === true,
      },
    });

    return {
      attemptId: tentativa.id,
      status: resposta.status,
      checkoutUrl: null,
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

    const demo = mock || resposta.pagadorSubstituido === true;
    // A preferência do Checkout Pro tem coluna própria. Guardá-la em
    // `externalId` — que é por onde a reconciliação consulta `/v1/payments` —
    // garantia 404 e uma compra paga que nunca liberava nada.
    const preferenceId = resposta.preferenceId ?? null;

    await db.$transaction([
      db.paymentAttempt.update({
        where: { id: tentativa.id },
        data: {
          externalId: resposta.externalId,
          externalPreferenceId: preferenceId,
          status: mapaTentativa(resposta.status),
          rawStatus: resposta.status,
          checkoutUrl: resposta.checkoutUrl,
          pixQrCode: resposta.pixQrCode,
          expiresAt: resposta.expiraEm,
          isDemo: demo,
        },
      }),
      db.purchase.update({
        where: { id: compra.id },
        data: {
          isDemo: demo,
          externalPreferenceId: preferenceId,
        },
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
  /**
   * O que o provedor respondeu na reconsulta. É isto que o webhook grava em
   * `WebhookEvent.providerSnapshot` — a prova do que autorizou a mudança, e
   * não o corpo do webhook, que não autoriza nada.
   */
  snapshot?: unknown;
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

  // Cobrança de assinatura: o provedor aponta o preapproval, ou a tentativa
  // original é de assinatura. Aprovada ou recusada, quem decide é o livro de
  // ciclos — reembolso e chargeback seguem o caminho de devolução de sempre.
  const tentativa = await localizarTentativa(consulta, provedor.nome);

  // Ciclo mensal pago à mão: a cobrança é este pagamento, não a fatura de um
  // contrato. Mandá-lo para o caminho do preapproval consultaria
  // `/preapproval/<id de pagamento>` e receberia 404 — a mesma classe de erro
  // que uma vez fez compra paga não liberar nada.
  if (
    tentativa?.kind === "SUBSCRIPTION" &&
    tentativa.billingMode === "MANUAL_RENEW" &&
    consulta.status !== "REFUNDED" &&
    consulta.status !== "CHARGEBACK"
  ) {
    return reconciliarCicloManual(tentativa, consulta, { origem: "pagamento" });
  }

  const preapprovalId =
    consulta.preapprovalId ??
    (tentativa?.kind === "SUBSCRIPTION" && tentativa.billingMode !== "MANUAL_RENEW"
      ? tentativa.externalId
      : null);

  if (
    preapprovalId &&
    consulta.status !== "REFUNDED" &&
    consulta.status !== "CHARGEBACK"
  ) {
    return reconciliarCicloDeAssinatura(preapprovalId, { origem: "pagamento" });
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
    // A tentativa de uma assinatura é o checkout que a pessoa fez: guarda o
    // preapproval em `externalId` para sempre. Sobrescrevê-la com o id da
    // cobrança do mês fazia a próxima reconsulta procurar a assinatura pelo
    // id de um pagamento.
    if (tentativa.kind !== "SUBSCRIPTION") {
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
    }

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

/**
 * Reconcilia uma **compra avulsa**, descobrindo o pagamento real primeiro.
 *
 * O Checkout Pro tem três objetos e só um deles pode ser consultado em
 * `/v1/payments`:
 *
 *   preferência    o que criamos antes de existir pagamento
 *   merchant order o pedido que agrupa as tentativas daquela preferência
 *   payment        a cobrança de verdade — a única que decide o estado
 *
 * Guardar a preferência como se fosse pagamento fazia `/v1/payments/<pref>`
 * responder 404, a reconciliação devolver "inexistente" e a compra paga não
 * liberar nada. A tela de espera girava para sempre e o webhook era a única
 * salvação — que é justamente o que pode não chegar.
 *
 * A ordem aqui é do mais barato e mais confiável para o mais caro:
 *
 * 1. `paymentId` explícito (veio na `back_url` ou no webhook de `payment`);
 * 2. `externalId` já gravado, que a esta altura só é um pagamento;
 * 3. a merchant order conhecida;
 * 4. a preferência, resolvida em pedido e daí em pagamentos.
 *
 * Idempotente: `reconciliarPagamento` é, e os ids descobertos são gravados
 * para que a próxima passagem já comece do passo 2.
 */
export async function reconciliarCompra(
  tentativaId: string,
  paymentIdExplicito?: string | null,
): Promise<ResultadoReconciliacao> {
  const tentativa = await db.paymentAttempt.findUnique({
    where: { id: tentativaId },
  });

  if (!tentativa) {
    return {
      mudou: false,
      motivo: "tentativa inexistente",
      attemptId: null,
      status: "UNKNOWN",
    };
  }

  const provedor = provedorDePagamento();
  const candidatos: string[] = [];

  if (paymentIdExplicito) candidatos.push(paymentIdExplicito);
  if (tentativa.externalId) candidatos.push(tentativa.externalId);

  // Descobrir custa uma ida a mais ao provedor, então só quando os ids que já
  // temos não bastam.
  if (candidatos.length === 0) {
    let merchantOrderId = tentativa.externalMerchantOrderId;

    if (!merchantOrderId && tentativa.externalPreferenceId) {
      const resolucao = await provedor.resolverPreferencia(
        tentativa.externalPreferenceId,
      );

      if (resolucao) {
        merchantOrderId = resolucao.merchantOrderId;
        candidatos.push(...resolucao.pagamentoIds);

        if (merchantOrderId) {
          await db.paymentAttempt.update({
            where: { id: tentativa.id },
            data: { externalMerchantOrderId: merchantOrderId },
          });
        }
      }
    } else if (merchantOrderId) {
      candidatos.push(...(await provedor.pagamentosDaMerchantOrder(merchantOrderId)));
    }
  }

  if (candidatos.length === 0) {
    // Estado legítimo: abriu o checkout e ainda não pagou. Não é erro, e
    // mexer na tentativa aqui apagaria o `PENDING` que a tela usa.
    return {
      mudou: false,
      motivo: "pagamento ainda não existe no provedor",
      attemptId: tentativa.id,
      status: "PENDING",
    };
  }

  // `candidatos` vem ordenado pelo provedor com o desfecho que vale na frente:
  // um cartão recusado seguido de um aprovado não pode marcar a compra como
  // recusada. O primeiro que o provedor reconhecer decide.
  let ultimo: ResultadoReconciliacao | null = null;

  for (const paymentId of candidatos) {
    const resultado = await reconciliarPagamento(paymentId);
    ultimo = resultado;
    if (resultado.attemptId) return resultado;
  }

  return (
    ultimo ?? {
      mudou: false,
      motivo: "nenhum pagamento reconciliável",
      attemptId: tentativa.id,
      status: "PENDING",
    }
  );
}

/**
 * Reconcilia tudo que um `merchant_order` contém.
 *
 * O webhook de `merchant_order` traz o id do **pedido**, não o do pagamento.
 * Mandá-lo direto para `/v1/payments` devolvia 404 e o evento era gravado como
 * PROCESSED tendo feito nada — a auditoria mentia.
 */
export async function reconciliarMerchantOrder(
  merchantOrderId: string,
): Promise<ResultadoReconciliacao> {
  const provedor = provedorDePagamento();
  const pagamentoIds = await provedor.pagamentosDaMerchantOrder(merchantOrderId);

  if (pagamentoIds.length === 0) {
    return {
      mudou: false,
      motivo: "merchant order sem pagamento ainda",
      attemptId: null,
      status: "PENDING",
    };
  }

  let ultimo: ResultadoReconciliacao | null = null;

  for (const paymentId of pagamentoIds) {
    const resultado = await reconciliarPagamento(paymentId);
    ultimo = resultado;

    if (resultado.attemptId) {
      // Guardar o pedido encurta a próxima reconciliação desta tentativa.
      await db.paymentAttempt.updateMany({
        where: { id: resultado.attemptId, externalMerchantOrderId: null },
        data: { externalMerchantOrderId: merchantOrderId },
      });
      return resultado;
    }
  }

  return (
    ultimo ?? {
      mudou: false,
      motivo: "merchant order sem tentativa correspondente",
      attemptId: null,
      status: "UNKNOWN",
    }
  );
}

// ---------------------------------------------------- ciclos de assinatura
//
// Uma cobrança real concede no máximo um ciclo. Um ciclo é pago por no
// máximo uma cobrança.
//
// As duas metades moram no banco, não em `if`: `Payment` é único por
// `(provider, externalId)` e por `(subscriptionId, cycleIndex)`. Reentrega de
// webhook, retorno e polling ao mesmo tempo, cron rodando junto — tudo isso
// esbarra numa das duas unicidades antes de conceder um mês a mais.
//
// Antes havia três portas para o mesmo evento, e cada uma decidia sozinha:
// `ativarAssinatura` estendia o ciclo a cada pagamento aprovado, inclusive na
// reentrega; a ativação pelo preapproval concedia o ciclo 1 sem registrar a
// cobrança que o pagou, então o primeiro pagamento, quando aparecesse, ganharia
// um segundo ciclo; e todo pagamento aprovado apagava `cancelAtPeriodEnd`.

/**
 * Tolerância depois do fim do ciclo pago. Fixa a partir do `currentPeriodEnd`:
 * uma retentativa recusada não recomeça a contagem, e uma recusa entregue três
 * vezes não corta ninguém — cortar é decisão do tempo, não da contagem.
 */
const TOLERANCIA_MS = 3 * 86_400_000;

/**
 * Por quanto tempo uma assinatura já EXPIRED continua sendo reconciliada.
 *
 * Uma cobrança pode aprovar depois de a tolerância acabar — retentativa do
 * provedor, pagamento em análise. Sem esta janela, a assinatura expirada nunca
 * mais seria olhada e o cliente que pagou ficaria sem o ciclo. Com prazo, e
 * não para sempre: o histórico inteiro não precisa de uma ida ao provedor por
 * dia.
 */
const JANELA_DE_RECUPERACAO_MS = 30 * 86_400_000;

export type OpcoesDeCiclo = {
  /** Quem pediu a reconciliação. Vai para a auditoria de cada mudança. */
  origem: string;
  /**
   * Autoriza vincular o ciclo já concedido de uma assinatura antiga — ativada
   * antes do livro de ciclos existir — ao pagamento que o pagou.
   *
   * Desligado por padrão. Enquanto houver assinatura nesse estado, qualquer
   * outra porta (webhook, polling, cron) devolve `vinculo-legado-pendente` e
   * não escreve nada: a migração dessas assinaturas é um passo explícito.
   */
  permitirVinculoLegado?: boolean;
};

export type ResultadoDeCiclo = ResultadoReconciliacao & {
  ciclosNovos: number;
  recusasNovas: number;
  /** Faturas do preapproval que já têm cobrança — aprovada, recusada ou pendente. */
  cobrancasEncontradas: number;
  /** O ciclo pago acabou e a renovação ainda não foi aprovada: em tolerância. */
  renovacaoPendente: boolean;
  vinculoLegadoPendente?: boolean;
  /** Para a checagem cruzada da reconciliação periódica. */
  conferencia?: { cobrancasNoProvedor: number | null; ciclosNoLivro: number };
};

type Assinatura = Prisma.SubscriptionGetPayload<object>;

/**
 * O que este preapproval é para a assinatura da pessoa.
 *
 *   novo    ainda não é o vigente: uma assinatura nova, que pode ativar
 *   atual   é o `externalPreapprovalId` vigente: renova, recusa, cancela
 *   antigo  foi substituído por um mais recente: registra, nunca estende
 */
type Papel = "novo" | "atual" | "antigo";

type ContextoDeCiclo = {
  /** Nulo na renovação manual: não existe contrato, só a cobrança avulsa. */
  preapprovalId: string | null;
  tentativa: Tentativa;
  plano: DefinicaoDePlano;
  provedorNome: string;
  opcoes: OpcoesDeCiclo;
  /**
   * Quem renova. É o único eixo em que os dois fluxos divergem dentro de
   * `concederCiclo`, e está aqui em vez de espalhado em `if (metodo === "pix")`
   * — que é como as duas metades acabariam divergindo na próxima mudança.
   */
  billingMode: BillingMode;
};

/**
 * Uma cobrança do provedor, na forma que o livro de ciclos entende.
 *
 * Existe para que **haja uma porta só** para conceder um ciclo. A cobrança de
 * um preapproval chega como `FaturaDeAssinatura` e a do Pix como
 * `ConsultaPagamento`; normalizar aqui é o que evita um segundo
 * `concederCiclo` — e este arquivo já pagou o preço de ter três caminhos
 * decidindo a mesma coisa, cada um esquecendo uma checagem diferente.
 */
type CobrancaDoProvedor = {
  pagamentoId: string;
  /** Fatura do preapproval. Nulo na cobrança manual: não há fatura. */
  invoiceId: string | null;
  valorCents: number;
  moeda: string;
  metodo: string | null;
  cobradoEm: Date;
  statusCru: string | null;
  detalheCru: string | null;
};

function deFatura(fatura: FaturaDeAssinatura): CobrancaDoProvedor {
  const pagamento = fatura.pagamento!;
  return {
    pagamentoId: pagamento.id,
    invoiceId: fatura.id,
    valorCents: fatura.valorCents,
    moeda: fatura.moeda,
    metodo: fatura.metodo,
    cobradoEm: fatura.dataDebito ?? new Date(),
    statusCru: pagamento.statusCru,
    detalheCru: pagamento.detalheCru,
  };
}

function deConsulta(consulta: ConsultaPagamento): CobrancaDoProvedor {
  return {
    pagamentoId: consulta.externalId,
    invoiceId: null,
    valorCents: consulta.valorCents,
    moeda: consulta.moeda,
    metodo: consulta.metodo,
    // A data do provedor, não `new Date()`: é dela que sai o início do ciclo,
    // e reconciliar dois dias depois não pode mudar até quando a pessoa pagou.
    cobradoEm: consulta.aprovadoEm ?? new Date(),
    statusCru: consulta.statusCru,
    detalheCru: consulta.detalheCru,
  };
}

class VinculoLegadoPendente extends Error {
  constructor() {
    super("vinculo-legado-pendente");
    this.name = "VinculoLegadoPendente";
  }
}

const PLANOS_PAGOS: SubscriptionPlan[] = ["MONTHLY", "ANNUAL", "PREMIUM", "VIP"];

/**
 * A única porta para o estado de uma assinatura recorrente.
 *
 * Ativação, renovação, recusa, retentativa aprovada, cancelamento e pausa: tudo
 * sai daqui, a partir do que o provedor diz **agora** — preapproval, faturas e
 * a cobrança de cada fatura. Nada vem do corpo de um webhook.
 *
 * Por isso a mesma chamada serve para o webhook de qualquer tópico, para o
 * retorno do checkout, para a tela de espera e para o cron. Chamada duas vezes,
 * converge para o mesmo estado; chamada em paralelo, uma das unicidades do
 * `Payment` segura a outra.
 */
export async function reconciliarCicloDeAssinatura(
  preapprovalId: string,
  opcoes: OpcoesDeCiclo,
): Promise<ResultadoDeCiclo> {
  const provedor = provedorDePagamento();
  const semEfeito = {
    ciclosNovos: 0,
    recusasNovas: 0,
    cobrancasEncontradas: 0,
    renovacaoPendente: false,
  };

  const pre = await provedor.consultarAssinatura(preapprovalId);
  if (!pre) {
    return {
      ...semEfeito,
      mudou: false,
      motivo: "assinatura inexistente no provedor",
      attemptId: null,
      status: "UNKNOWN",
    };
  }

  const tentativa = await localizarTentativaDaAssinatura(
    pre.referenciaExterna,
    preapprovalId,
    provedor.nome,
  );
  if (!tentativa) {
    return {
      ...semEfeito,
      mudou: false,
      motivo: "sem tentativa correspondente",
      attemptId: null,
      status: pre.status,
      snapshot: pre,
    };
  }

  const ctx: ContextoDeCiclo = {
    preapprovalId,
    tentativa,
    plano: planoPorCodigo(tentativa.plan ?? "MONTHLY"),
    provedorNome: provedor.nome,
    opcoes,
    billingMode: "AUTO_RENEW",
  };

  const pendente = {
    ...semEfeito,
    mudou: false,
    motivo: "vinculo-legado-pendente",
    vinculoLegadoPendente: true,
    attemptId: tentativa.id,
    status: pre.status,
    snapshot: pre,
  };

  // A trava da migração. Checada antes de qualquer escrita — inclusive a de
  // cancelamento — para que "não mexer nas assinaturas antigas" seja literal.
  const inicial = await db.subscription.findUnique({
    where: { userId: tentativa.userId },
  });
  if (
    inicial &&
    !opcoes.permitirVinculoLegado &&
    (await ehLegado(db, inicial, preapprovalId))
  ) {
    return pendente;
  }

  // Ordem de débito, sempre. Webhook fora de ordem, página da API em outra
  // ordem, dois caminhos ao mesmo tempo: todos atribuem o mesmo ciclo à mesma
  // cobrança porque todos percorrem as faturas na mesma sequência.
  const todasFaturas = (await provedor.listarFaturas(preapprovalId)).filter(
    (f) => !f.preapprovalId || f.preapprovalId === preapprovalId,
  );
  const faturas = todasFaturas
    .filter((f) => f.pagamento)
    .sort(porOrdemDeDebito);

  let ciclosNovos = 0;
  let recusasNovas = 0;

  try {
    for (const fatura of faturas) {
      const status = fatura.pagamento!.status;
      if (status === "APPROVED") {
        if (await registrarCobrancaAprovada(ctx, deFatura(fatura))) {
          ciclosNovos += 1;
        }
      } else if (status === "REJECTED" || status === "CANCELED") {
        if (await registrarCobrancaRecusada(ctx, deFatura(fatura))) {
          recusasNovas += 1;
        }
      }
    }
  } catch (erro) {
    if (erro instanceof VinculoLegadoPendente) return pendente;
    throw erro;
  }

  const estadoMudou = await aplicarEstadoDoPreapproval(ctx, pre.status, pre.statusCru ?? null);

  // Depois das cobranças e do estado do preapproval — e antes de qualquer
  // expiração, que só roda depois desta função: o ciclo pago acabou sem
  // renovação aprovada? Então tolerância, não corte.
  const tolerancia = await abrirToleranciaDeRenovacao(
    ctx,
    pre.status,
    faturaPendenteDe(todasFaturas),
  );

  const ciclosNoLivro = await db.payment.count({
    where: {
      attemptId: tentativa.id,
      cycleIndex: { not: null },
      status: "APPROVED",
    },
  });

  const checkoutRecusado = await encerrarCheckoutRecusado(
    ctx,
    pre,
    faturas,
    ciclosNoLivro,
  );

  const mudou =
    ciclosNovos > 0 ||
    recusasNovas > 0 ||
    estadoMudou ||
    tolerancia.mudou ||
    checkoutRecusado;

  return {
    mudou,
    motivo: mudou
      ? `ciclos novos: ${ciclosNovos}, recusas novas: ${recusasNovas}` +
        (estadoMudou ? ", estado do preapproval aplicado" : "") +
        (tolerancia.mudou ? ", tolerância de renovação aberta" : "") +
        (checkoutRecusado ? ", checkout recusado" : "")
      : "nada novo no provedor",
    attemptId: tentativa.id,
    status: pre.status,
    snapshot: pre,
    ciclosNovos,
    recusasNovas,
    cobrancasEncontradas: faturas.length,
    renovacaoPendente: tolerancia.pendente,
    conferencia: {
      cobrancasNoProvedor: pre.cobrancasRealizadas ?? null,
      ciclosNoLivro,
    },
  };
}

/**
 * O checkout de assinatura foi recusado de vez: fecha a tentativa.
 *
 * Quando a **primeira** cobrança de um preapproval é recusada, o Mercado Pago
 * cancela o preapproval sozinho — visto em produção com
 * `cc_rejected_high_risk`: preapproval `cancelled`, `charged_amount 0`. A
 * recusa entrava no livro (`Payment` FAILED) mas a tentativa ficava em
 * PENDING para sempre, e a tela de espera girava para uma cobrança que já
 * tinha morrido.
 *
 * Só fecha o que é definitivo, e só o checkout inicial:
 *
 *   - nenhum ciclo aprovado no livro para esta tentativa (é ativação, não
 *     renovação — recusa de renovação vai para a tolerância, não para cá);
 *   - o preapproval está cancelado no provedor (enquanto está `pending` ou
 *     `authorized`, uma retentativa ainda pode aprovar);
 *   - a última cobrança das faturas foi recusada.
 *
 * Idempotente pela atualização condicional: só sai de CREATED/PENDING. Os
 * três webhooks, o polling e o cron passam por aqui e só o primeiro escreve.
 * Uma nova assinatura cria uma tentativa nova; esta fica como histórico.
 */
async function encerrarCheckoutRecusado(
  ctx: ContextoDeCiclo,
  pre: ConsultaAssinatura,
  faturas: FaturaDeAssinatura[],
  ciclosNoLivro: number,
): Promise<boolean> {
  if (ciclosNoLivro > 0) return false;
  if (pre.status !== "CANCELED") return false;

  const ultima = faturas[faturas.length - 1]?.pagamento;
  if (!ultima || (ultima.status !== "REJECTED" && ultima.status !== "CANCELED")) {
    return false;
  }

  const { count } = await db.paymentAttempt.updateMany({
    where: { id: ctx.tentativa.id, status: { in: ["CREATED", "PENDING"] } },
    data: {
      status: "REJECTED",
      rawStatus: ultima.statusCru ?? "rejected",
      failureCode: ultima.detalheCru,
      failureMessage: mensagemDeRecusa(ultima.detalheCru),
    },
  });
  return count === 1;
}

/**
 * O que a pessoa lê quando a cobrança é recusada.
 *
 * O `status_detail` do provedor (`cc_rejected_high_risk`,
 * `cc_rejected_insufficient_amount`…) é para o log e para o suporte, não
 * para a tela. Aqui só o que ajuda a decidir o próximo passo.
 */
export function mensagemDeRecusa(detalheCru: string | null): string {
  switch (detalheCru) {
    case "cc_rejected_insufficient_amount":
      return "O cartão não tem limite suficiente para esta cobrança. Tente outro cartão ou meio de pagamento.";
    case "cc_rejected_bad_filled_card_number":
    case "cc_rejected_bad_filled_date":
    case "cc_rejected_bad_filled_security_code":
    case "cc_rejected_bad_filled_other":
      return "Algum dado do cartão foi digitado errado. Confira e tente de novo.";
    case "cc_rejected_call_for_authorize":
      return "O banco pediu para você autorizar esta cobrança. Ligue para o emissor do cartão ou use outro meio de pagamento.";
    case "cc_rejected_card_disabled":
      return "Este cartão está desativado. Ligue para o emissor ou use outro meio de pagamento.";
    case "cc_rejected_duplicated_payment":
      return "Você já fez um pagamento com este valor há pouco. Se precisar pagar de novo, use outro cartão.";
    default:
      return "Não foi possível aprovar este pagamento. Tente outro cartão ou meio de pagamento.";
  }
}

/**
 * `subscription_authorized_payment` traz o id da **fatura**.
 *
 * Confirmado contra a API real: `GET /v1/payments/<id da fatura>` responde
 * 404. O caminho é fatura → preapproval → a reconciliação inteira.
 */
export async function reconciliarFatura(
  faturaId: string,
): Promise<ResultadoDeCiclo> {
  const fatura = await provedorDePagamento().consultarFatura(faturaId);

  if (!fatura?.preapprovalId) {
    return {
      mudou: false,
      motivo: "fatura inexistente no provedor",
      attemptId: null,
      status: "UNKNOWN",
      ciclosNovos: 0,
      recusasNovas: 0,
      cobrancasEncontradas: 0,
      renovacaoPendente: false,
    };
  }

  return reconciliarCicloDeAssinatura(fatura.preapprovalId, {
    origem: "webhook:subscription_authorized_payment",
  });
}

/**
 * A porta do ciclo mensal pago à mão.
 *
 * O paralelo exato de `reconciliarCicloDeAssinatura`, para o outro modo de
 * renovação — e como lá, **tudo** passa por aqui: webhook, tela de espera,
 * varredura e o retorno. Chamada duas vezes, converge; chamada em paralelo,
 * a unicidade do `Payment` segura a segunda.
 *
 * A diferença de forma é que aqui não existe contrato a consultar. A cobrança
 * é um pagamento avulso, e o que ela concede sai de `concederCiclo` — a mesma
 * função que o cartão usa.
 */
export async function reconciliarCicloManual(
  tentativa: Tentativa,
  consulta: ConsultaPagamento,
  opcoes: OpcoesDeCiclo,
): Promise<ResultadoDeCiclo> {
  const provedor = provedorDePagamento();
  const ctx: ContextoDeCiclo = {
    preapprovalId: null,
    tentativa,
    plano: planoPorCodigo(tentativa.plan ?? "MONTHLY"),
    provedorNome: provedor.nome,
    opcoes,
    billingMode: "MANUAL_RENEW",
  };

  // A tentativa **é** a cobrança neste modo, então espelhar o estado do
  // provedor nela é o certo — ao contrário do cartão, onde `externalId` guarda
  // o contrato e sobrescrevê-lo com o id da cobrança do mês quebrava a
  // reconsulta seguinte.
  const tentativaMudou = await db.paymentAttempt.updateMany({
    where: { id: tentativa.id, status: { in: ["CREATED", "PENDING"] } },
    data: {
      status: mapaTentativa(consulta.status),
      rawStatus: consulta.statusCru,
      method: consulta.metodo ?? tentativa.method,
      failureCode: consulta.detalheCru,
      ...(consulta.status === "REJECTED"
        ? { failureMessage: mensagemDeRecusa(consulta.detalheCru) }
        : {}),
    },
  });

  const base = {
    attemptId: tentativa.id,
    status: consulta.status,
    snapshot: consulta,
    recusasNovas: 0,
    cobrancasEncontradas: 1,
    renovacaoPendente: false,
  };

  if (consulta.status === "APPROVED") {
    const concedeu = await registrarCobrancaAprovada(ctx, deConsulta(consulta));
    return {
      ...base,
      mudou: concedeu || tentativaMudou.count > 0,
      motivo: concedeu ? "ciclo mensal concedido" : "cobrança já registrada",
      ciclosNovos: concedeu ? 1 : 0,
    };
  }

  // Recusado, cancelado ou expirado: nada foi cobrado e nenhum acesso muda.
  // A tentativa fecha, e a tela oferece gerar outro Pix — a anterior fica no
  // histórico, que é como se descobre depois quantos QR nunca foram pagos.
  return {
    ...base,
    mudou: tentativaMudou.count > 0,
    motivo:
      consulta.status === "PENDING"
        ? "aguardando o pagamento"
        : `cobrança encerrada sem pagamento (${consulta.status})`,
    ciclosNovos: 0,
  };
}

/**
 * Nome antigo, mesma porta. Retorno do checkout e tela de espera chamam por
 * aqui; o comportamento é inteiro o de `reconciliarCicloDeAssinatura`.
 */
export async function reconciliarAssinatura(
  externalId: string,
): Promise<ResultadoDeCiclo> {
  return reconciliarCicloDeAssinatura(externalId, { origem: "consulta" });
}

function porOrdemDeDebito(a: FaturaDeAssinatura, b: FaturaDeAssinatura) {
  const ta = a.dataDebito?.getTime() ?? 0;
  const tb = b.dataDebito?.getTime() ?? 0;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

async function localizarTentativaDaAssinatura(
  referencia: string | null,
  preapprovalId: string,
  provedorNome: string,
): Promise<Tentativa | null> {
  if (referencia) {
    const porReferencia = await db.paymentAttempt.findUnique({
      where: { id: referencia },
    });
    if (porReferencia?.kind === "SUBSCRIPTION") return porReferencia;
  }

  return db.paymentAttempt.findFirst({
    where: { provider: provedorNome, externalId: preapprovalId, kind: "SUBSCRIPTION" },
  });
}

/**
 * Assinatura cujo ciclo vigente foi concedido antes do livro de ciclos: plano
 * pago, preapproval vigente igual a este, e nenhum ciclo registrado.
 */
async function ehLegado(
  conexao: Conexao,
  assinatura: Assinatura,
  preapprovalId: string,
): Promise<boolean> {
  if (assinatura.externalPreapprovalId !== preapprovalId) return false;
  if (!PLANOS_PAGOS.includes(assinatura.plan)) return false;
  if (!assinatura.currentPeriodEnd) return false;

  const ciclos = await conexao.payment.count({
    where: { subscriptionId: assinatura.id, cycleIndex: { not: null } },
  });
  return ciclos === 0;
}

async function papelDoPreapproval(
  conexao: Conexao,
  assinatura: Assinatura | null,
  ctx: ContextoDeCiclo,
): Promise<Papel> {
  // Renovação manual não tem contrato, e portanto não tem papel: quem chama
  // por aqui sem preapproval está no caminho errado. Sem esta guarda, duas
  // colunas nulas se comparariam iguais e uma cobrança Pix se declararia
  // "atual" do contrato de cartão de outra pessoa.
  if (!ctx.preapprovalId) return "novo";
  if (!assinatura?.externalPreapprovalId) return "novo";
  if (assinatura.externalPreapprovalId === ctx.preapprovalId) return "atual";

  // Outro preapproval é o vigente. Este só assume se for mais recente — uma
  // assinatura nova. Um checkout antigo, abandonado e pago depois, não tira o
  // lugar de quem está valendo.
  const vigente = await conexao.paymentAttempt.findFirst({
    where: {
      provider: ctx.provedorNome,
      externalId: assinatura.externalPreapprovalId,
      kind: "SUBSCRIPTION",
    },
  });
  if (!vigente || ctx.tentativa.createdAt > vigente.createdAt) return "novo";
  return "antigo";
}

function dadosDaCobranca(
  ctx: ContextoDeCiclo,
  cobranca: CobrancaDoProvedor,
  subscriptionId: string | null,
) {
  return {
    userId: ctx.tentativa.userId,
    subscriptionId,
    invoiceId: cobranca.invoiceId,
    kind: "SUBSCRIPTION" as const,
    plan: ctx.plano.code,
    // Como esta cobrança renovava, no dia em que aconteceu. O painel separa
    // renovação de cartão de renovação Pix por aqui, e não pelo estado atual
    // da assinatura — que só conhece o hoje.
    billingMode: ctx.billingMode,
    amountCents: cobranca.valorCents,
    currency: cobranca.moeda,
    provider: ctx.provedorNome,
    externalId: cobranca.pagamentoId,
    method: cobranca.metodo,
    attemptId: ctx.tentativa.id,
    isDemo: ctx.tentativa.isDemo,
  };
}

/**
 * Relê-e-tenta. A checagem antes da escrita é otimização; quem garante é a
 * unicidade — e quando ela dispara, outra passagem gravou primeiro, então
 * relemos e decidimos de novo em vez de falhar.
 */
async function comConflitoIdempotente<T>(
  pagamentoId: string,
  provedorNome: string,
  jaRegistrado: T,
  gravar: () => Promise<T>,
): Promise<T> {
  for (let volta = 0; volta < 5; volta += 1) {
    const existente = await db.payment.findFirst({
      where: { provider: provedorNome, externalId: pagamentoId },
      select: { id: true },
    });
    if (existente) return jaRegistrado;

    try {
      return await gravar();
    } catch (erro) {
      if (ehViolacaoDeUnicidade(erro)) continue;
      throw erro;
    }
  }

  throw new Error(`conflito persistente ao registrar a cobrança ${pagamentoId}`);
}

/** Devolve `true` se esta chamada concedeu (ou vinculou) um ciclo. */
async function registrarCobrancaAprovada(
  ctx: ContextoDeCiclo,
  cobranca: CobrancaDoProvedor,
): Promise<boolean> {
  return comConflitoIdempotente(cobranca.pagamentoId, ctx.provedorNome, false, () =>
    db.$transaction((tx) => concederCiclo(tx, ctx, cobranca)),
  );
}

/**
 * A única porta que concede um ciclo — nos dois modos de renovação.
 *
 * Cartão e Pix entram aqui pela mesma função de propósito. As garantias que
 * importam (o `Payment` criado antes de qualquer outra escrita, o índice
 * `cycleIndex` que impede o mês em dobro, o período que nunca encurta, o
 * direito estendido em vez de duplicado) valem uma vez, para os dois, e não
 * podem divergir por alguém ter corrigido só metade.
 *
 * O que o modo muda, e só isto:
 *
 *   AUTO_RENEW    o papel do preapproval decide se é ativação, renovação ou
 *                 cobrança de um contrato substituído; `graceUntil` é limpo,
 *                 porque tolerância ali nasce de cobrança recusada.
 *   MANUAL_RENEW  não há contrato nem papel; o início sai de `inicioDoCiclo`,
 *                 que já conhece renovação antecipada, carência e volta
 *                 tardia; `graceUntil` nasce com o ciclo, porque no Pix a
 *                 carência é parte da regra, não sintoma de problema.
 */
async function concederCiclo(
  tx: Prisma.TransactionClient,
  ctx: ContextoDeCiclo,
  cobranca: CobrancaDoProvedor,
): Promise<boolean> {
  const { tentativa, plano, preapprovalId, opcoes } = ctx;
  const manual = ctx.billingMode === "MANUAL_RENEW";
  const { pagamentoId, cobradoEm } = cobranca;

  const assinatura =
    (await tx.subscription.findUnique({ where: { userId: tentativa.userId } })) ??
    (await tx.subscription.create({
      data: { userId: tentativa.userId, plan: "FREE", status: "ACTIVE" },
    }));

  const ultimo = await tx.payment.findFirst({
    where: { subscriptionId: assinatura.id, cycleIndex: { not: null } },
    orderBy: { cycleIndex: "desc" },
  });
  const cycleIndex = (ultimo?.cycleIndex ?? 0) + 1;

  // O fim do ciclo anterior, venha ele do livro ou de uma assinatura antiga
  // que nunca teve livro. É a única entrada que decide o início do próximo.
  const fimAnterior =
    ultimo?.periodEnd ??
    (PLANOS_PAGOS.includes(assinatura.plan) ? assinatura.currentPeriodEnd : null);

  let papel: Papel;
  let inicio: Date;

  if (manual) {
    // Só datas decidem. Condicionar a carência ao `status` faria um cron
    // atrasado mudar quanto tempo alguém recebeu pelo que pagou.
    inicio = inicioDoCiclo(fimAnterior, cobradoEm, CARENCIA_MANUAL_MS);
    // Ciclo que nasce no próprio pagamento é começo de vida — assinar pela
    // primeira vez ou voltar depois da carência. Encadeado é renovação.
    papel = inicio.getTime() === cobradoEm.getTime() ? "novo" : "atual";
  } else {
    papel = await papelDoPreapproval(tx, assinatura, ctx);

    if (papel === "antigo") {
      // Dinheiro que entrou é receita e fica registrado — mas não é deste
      // preapproval que o acesso depende, então não move data nenhuma.
      await tx.payment.create({
        data: {
          ...dadosDaCobranca(ctx, cobranca, assinatura.id),
          status: "APPROVED",
        },
      });
      return false;
    }

    const legado =
      papel === "atual" &&
      !ultimo &&
      PLANOS_PAGOS.includes(assinatura.plan) &&
      assinatura.currentPeriodEnd !== null;

    if (legado) {
      if (!opcoes.permitirVinculoLegado) throw new VinculoLegadoPendente();

      // O ciclo 1 já foi concedido pelo caminho antigo. Vincular é só dizer
      // qual cobrança o pagou: nenhuma data se move, nada de cancelamento muda.
      await tx.payment.create({
        data: {
          ...dadosDaCobranca(ctx, cobranca, assinatura.id),
          status: "APPROVED",
          cycleIndex,
          periodStart: assinatura.currentPeriodStart ?? cobradoEm,
          periodEnd: assinatura.currentPeriodEnd,
        },
      });
      return true;
    }

    // Renovação encadeia no fim do ciclo anterior — não em "hoje" —, e é isso
    // que torna o resultado igual em qualquer ordem de chegada. Assinatura
    // nova começa na cobrança, sem apagar dias que a pessoa ainda tinha pagos.
    if (papel === "atual" && ultimo?.periodEnd) {
      inicio = ultimo.periodEnd;
    } else if (
      assinatura.status === "ACTIVE" &&
      PLANOS_PAGOS.includes(assinatura.plan) &&
      assinatura.currentPeriodEnd &&
      assinatura.currentPeriodEnd > cobradoEm
    ) {
      inicio = assinatura.currentPeriodEnd;
    } else {
      inicio = cobradoEm;
    }
  }

  const fim = fimDoCiclo(plano, inicio);

  // Primeira escrita da transação, de propósito: se a unicidade disparar, nada
  // mais foi tocado.
  await tx.payment.create({
    data: {
      ...dadosDaCobranca(ctx, cobranca, assinatura.id),
      status: "APPROVED",
      cycleIndex,
      periodStart: inicio,
      periodEnd: fim,
    },
  });

  // Nunca encurta: um ciclo chegando atrasado não rouba dias já registrados.
  const fimVigente =
    assinatura.currentPeriodEnd && assinatura.currentPeriodEnd > fim
      ? assinatura.currentPeriodEnd
      : fim;

  await tx.subscription.update({
    where: { id: assinatura.id },
    data: {
      plan: plano.code,
      status: "ACTIVE",
      provider: ctx.provedorNome,
      priceCents: plano.precoCents,
      billingMode: ctx.billingMode,
      // No Pix vai a NULO de propósito. Quem veio do cartão deixaria para trás
      // um preapproval que a varredura diária consultaria para sempre — e o
      // histórico do contrato antigo continua em `PaymentAttempt` e
      // `SubscriptionEvent`, que é onde ele pertence.
      externalPreapprovalId: preapprovalId,
      currentPeriodStart: inicio,
      currentPeriodEnd: fimVigente,
      failedCharges: 0,
      // No cartão, `graceUntil` é sintoma: só existe quando uma cobrança
      // falhou, então um ciclo aprovado o apaga. No Pix é regra: o acesso vale
      // até o vencimento mais a carência, e a data nasce junto com o ciclo.
      graceUntil: manual ? fimDaCarencia(fimVigente, CARENCIA_MANUAL_MS) : null,
      // Só uma assinatura NOVA limpa um cancelamento. Cobrança do preapproval
      // vigente — atrasada, reentregue, retentativa — nunca desfaz o pedido
      // de quem cancelou. No Pix, pagar de novo **é** o pedido de continuar.
      ...(papel === "novo" || manual
        ? { startedAt: papel === "novo" ? inicio : assinatura.startedAt, cancelAtPeriodEnd: false, canceledAt: null }
        : {}),
    },
  });

  await concederAssinatura(
    {
      userId: tentativa.userId,
      kind:
        plano.entitlementKind === "SUBSCRIPTION_ANNUAL"
          ? "SUBSCRIPTION_ANNUAL"
          : "SUBSCRIPTION_MONTHLY",
      subscriptionId: assinatura.id,
      endsAt: fimVigente,
    },
    tx,
  );

  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: assinatura.id,
      userId: tentativa.userId,
      type: papel === "novo" ? "ACTIVATED" : "RENEWED",
      fromStatus: assinatura.status,
      toStatus: "ACTIVE",
      periodEnd: fimVigente,
      payload: {
        origem: opcoes.origem,
        paymentId: pagamentoId,
        invoiceId: cobranca.invoiceId,
        cycleIndex,
        billingMode: ctx.billingMode,
        periodStart: inicio.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  // No cartão, a tentativa é o **checkout** e sobrevive a todos os ciclos que
  // o contrato gerar: só muda de status na ativação. No Pix ela é a cobrança
  // daquele mês e morre com ele, então cada uma fecha aprovada — é o que a
  // tela de espera e o histórico leem.
  if ((papel === "novo" || manual) && tentativa.status !== "APPROVED") {
    await tx.paymentAttempt.update({
      where: { id: tentativa.id },
      data: {
        status: "APPROVED",
        rawStatus: manual ? (cobranca.statusCru ?? "approved") : "authorized",
      },
    });
  }

  return true;
}

/**
 * Cobrança recusada. Conta uma vez por `paymentId` — a mesma recusa
 * reentregue esbarra na unicidade — e não conta se a mesma fatura já foi paga
 * por uma retentativa.
 *
 * Não corta acesso. Abre a tolerância a partir do fim do ciclo pago; quem
 * encerra é o tempo, no cron, se nenhuma retentativa for aprovada até lá.
 */
async function registrarCobrancaRecusada(
  ctx: ContextoDeCiclo,
  cobranca: CobrancaDoProvedor,
): Promise<boolean> {
  return comConflitoIdempotente(cobranca.pagamentoId, ctx.provedorNome, false, () =>
    db.$transaction(async (tx) => {
      const assinatura = await tx.subscription.findUnique({
        where: { userId: ctx.tentativa.userId },
      });

      await tx.payment.create({
        data: {
          ...dadosDaCobranca(ctx, cobranca, assinatura?.id ?? null),
          status: "FAILED",
          failureCode: cobranca.detalheCru,
          failureMessage: cobranca.statusCru,
        },
      });

      if (!assinatura) return true;
      if ((await papelDoPreapproval(tx, assinatura, ctx)) !== "atual") return true;

      // Sem fatura não há retentativa a reconhecer. O `where` precisa do
      // guarda: `invoiceId: null` casaria com qualquer cobrança sem fatura, e
      // uma recusa qualquer passaria a se achar já paga.
      const faturaPaga = cobranca.invoiceId
        ? await tx.payment.findFirst({
            where: { invoiceId: cobranca.invoiceId, status: "APPROVED" },
            select: { id: true },
          })
        : null;
      if (faturaPaga) return true;

      const base =
        assinatura.currentPeriodEnd ?? cobranca.cobradoEm;

      // `increment` e não `falhas + 1`: duas recusas diferentes em paralelo
      // não podem virar uma só.
      await tx.subscription.update({
        where: { id: assinatura.id },
        data: { failedCharges: { increment: 1 } },
      });
      // A tolerância é aberta uma vez e não recomeça a cada retentativa.
      await tx.subscription.updateMany({
        where: { id: assinatura.id, graceUntil: null },
        data: { graceUntil: new Date(base.getTime() + TOLERANCIA_MS) },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: assinatura.id,
          userId: ctx.tentativa.userId,
          type: "PAYMENT_FAILED",
          fromStatus: assinatura.status,
          toStatus: assinatura.status,
          periodEnd: assinatura.currentPeriodEnd,
          payload: {
            origem: ctx.opcoes.origem,
            paymentId: cobranca.pagamentoId,
            invoiceId: cobranca.invoiceId,
            detalhe: cobranca.detalheCru,
          } as Prisma.InputJsonValue,
        },
      });

      return true;
    }),
  );
}

/**
 * Cancelado ou pausado no provedor.
 *
 * Os dois só marcam — nenhum revoga. Cancelado mantém o acesso até o fim do
 * ciclo pago; pausado (o provedor desistiu de cobrar) vira PAST_DUE e segue
 * até o fim do ciclo mais a tolerância. Quem encerra, nos dois casos, é a
 * data, no cron.
 *
 * `updateMany` com a condição no `where` torna isto idempotente mesmo em
 * paralelo: só uma passagem vê a linha mudar e só ela grava o evento.
 */
async function aplicarEstadoDoPreapproval(
  ctx: ContextoDeCiclo,
  status: EstadoProvedor,
  statusCru: string | null,
): Promise<boolean> {
  const assinatura = await db.subscription.findUnique({
    where: { userId: ctx.tentativa.userId },
  });
  if (!assinatura || assinatura.externalPreapprovalId !== ctx.preapprovalId) {
    return false;
  }

  if (status === "CANCELED") {
    return db.$transaction(async (tx) => {
      const { count } = await tx.subscription.updateMany({
        where: { id: assinatura.id, cancelAtPeriodEnd: false },
        data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
      });
      if (count === 0) return false;

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: assinatura.id,
          userId: ctx.tentativa.userId,
          type: "CANCELED",
          fromStatus: assinatura.status,
          toStatus: assinatura.status,
          periodEnd: assinatura.currentPeriodEnd,
          payload: {
            origem: ctx.opcoes.origem,
            providerStatus: statusCru,
            externalPreapprovalId: ctx.preapprovalId,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }

  if (statusCru === "paused") {
    return db.$transaction(async (tx) => {
      const base = assinatura.currentPeriodEnd ?? new Date();
      const { count } = await tx.subscription.updateMany({
        where: { id: assinatura.id, status: { not: "PAST_DUE" } },
        data: {
          status: "PAST_DUE",
          graceUntil:
            assinatura.graceUntil ?? new Date(base.getTime() + TOLERANCIA_MS),
        },
      });
      if (count === 0) return false;

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: assinatura.id,
          userId: ctx.tentativa.userId,
          type: "PAST_DUE",
          fromStatus: assinatura.status,
          toStatus: "PAST_DUE",
          periodEnd: assinatura.currentPeriodEnd,
          payload: {
            origem: ctx.opcoes.origem,
            providerStatus: statusCru,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }

  return false;
}

/** A fatura mais recente ainda sem desfecho: sem cobrança, ou cobrança pendente. */
function faturaPendenteDe(faturas: FaturaDeAssinatura[]): string | null {
  const pendentes = faturas
    .filter(
      (f) =>
        !f.pagamento ||
        f.pagamento.status === "PENDING" ||
        f.pagamento.status === "UNKNOWN",
    )
    .sort(porOrdemDeDebito);
  return pendentes.length ? pendentes[pendentes.length - 1]!.id : null;
}

/**
 * Renovação em andamento: o ciclo pago acabou, o preapproval segue
 * autorizado, ninguém pediu cancelamento e nenhuma cobrança aprovada cobriu o
 * ciclo seguinte ainda.
 *
 * É o cliente potencialmente pagante — a cobrança pode estar pendente, em
 * análise, ou nem ter aparecido no provedor. Antes, a expiração do cron o
 * tratava como quem não pagou: EXPIRED, e fora da reconciliação para sempre.
 *
 * Aqui ele vai para PAST_DUE com tolerância fixa a partir do fim do ciclo
 * pago — rodar o cron dez vezes não empurra a data —, mantém o acesso só até
 * lá e continua na mira da reconciliação diária. Se a cobrança aprovar,
 * `concederCiclo` normaliza tudo; se não, a expiração corta quando a
 * tolerância acabar.
 *
 * Quem pediu cancelamento não entra aqui: termina no fim do que pagou.
 */
async function abrirToleranciaDeRenovacao(
  ctx: ContextoDeCiclo,
  status: EstadoProvedor,
  faturaPendente: string | null,
): Promise<{ mudou: boolean; pendente: boolean }> {
  const agora = new Date();
  const assinatura = await db.subscription.findUnique({
    where: { userId: ctx.tentativa.userId },
  });

  if (
    !assinatura ||
    assinatura.externalPreapprovalId !== ctx.preapprovalId ||
    status !== "APPROVED" ||
    assinatura.cancelAtPeriodEnd ||
    !["ACTIVE", "TRIALING", "PAST_DUE"].includes(assinatura.status) ||
    !assinatura.currentPeriodEnd ||
    assinatura.currentPeriodEnd > agora
  ) {
    return { mudou: false, pendente: false };
  }

  const graceUntil =
    assinatura.graceUntil ??
    new Date(assinatura.currentPeriodEnd.getTime() + TOLERANCIA_MS);

  const mudou = await db.$transaction(async (tx) => {
    const { count } = await tx.subscription.updateMany({
      where: { id: assinatura.id, status: { not: "PAST_DUE" } },
      data: { status: "PAST_DUE", graceUntil },
    });
    if (count === 0) return false;

    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: assinatura.id,
        userId: ctx.tentativa.userId,
        type: "PAST_DUE",
        fromStatus: assinatura.status,
        toStatus: "PAST_DUE",
        periodEnd: assinatura.currentPeriodEnd,
        payload: {
          origem: ctx.opcoes.origem,
          motivo: "renovacao-pendente",
          faturaPendente,
          graceUntil: graceUntil.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    return true;
  });

  return { mudou, pendente: true };
}

export type ResumoDaReconciliacao = {
  iniciadoEm: string;
  concluidoEm: string | null;
  duracaoMs: number | null;
  completa: boolean;
  verificadas: number;
  /** Faturas com cobrança vistas no provedor, somadas entre as assinaturas. */
  cobrancasEncontradas: number;
  /** `summarized.charged_quantity` somado: o que o provedor diz ter cobrado. */
  cobrancasNoProvedor: number;
  /** Ciclos aprovados no nosso livro, somados. Tem de bater com a linha acima. */
  ciclosNoLivro: number;
  /** Assinaturas cujo ciclo acabou com a renovação ainda não aprovada. */
  renovacoesPendentes: number;
  /**
   * Assinaturas cuja reconciliação falhou nesta execução. A expiração as pula
   * nesta rodada: sem saber o que o provedor diz, cortar pode ser cortar um
   * pagante.
   */
  falhasIds: string[];
  mudaram: number;
  ciclosNovos: number;
  recusasNovas: number;
  pendentesDeVinculo: number;
  divergencias: number;
  falhas: number;
};

/**
 * Reconciliação periódica: descobre sozinha o que o webhook deveria ter
 * contado.
 *
 * Diária, só as assinaturas perto de virar o ciclo, em tolerância ou com
 * cobrança falha — o suficiente para renovar antes de o cron de expiração
 * cortar alguém que pagou. Completa (semanal), todas com preapproval — é
 * a que pega cancelamento feito direto no painel do Mercado Pago.
 *
 * Incremental por construção: cobrança já registrada é pulada pela
 * unicidade. Paginada no banco (lotes de 50) e no provedor
 * (`listarFaturas`). Uma assinatura que falha não para as outras.
 */
export async function reconciliarAssinaturasPeriodicamente(
  opcoes: { agora?: Date; completa?: boolean } = {},
): Promise<ResumoDaReconciliacao> {
  const agora = opcoes.agora ?? new Date();
  const completa = opcoes.completa ?? false;
  const limite = new Date(agora.getTime() + TOLERANCIA_MS);

  // Expiradas recentemente continuam na mira, nas duas execuções: é por aqui
  // que uma aprovação tardia recupera quem o cron já tinha cortado.
  const expiradaRecente: Prisma.SubscriptionWhereInput = {
    status: "EXPIRED",
    currentPeriodEnd: {
      gte: new Date(agora.getTime() - JANELA_DE_RECUPERACAO_MS),
    },
  };

  const onde: Prisma.SubscriptionWhereInput = completa
    ? {
        externalPreapprovalId: { not: null },
        OR: [
          { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
          expiradaRecente,
        ],
      }
    : {
        externalPreapprovalId: { not: null },
        OR: [
          {
            // Só assinaturas vivas. `graceUntil` e `failedCharges` continuam
            // gravados numa assinatura que expirou; sem este filtro de status,
            // uma EXPIRED que passou por tolerância seria consultada todo dia,
            // para sempre. Expiradas entram só pela janela de recuperação.
            status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
            OR: [
              { status: "PAST_DUE" },
              { failedCharges: { gt: 0 } },
              { graceUntil: { not: null } },
              { currentPeriodEnd: { lte: limite } },
            ],
          },
          expiradaRecente,
        ],
      };

  const inicio = Date.now();
  const resumo: ResumoDaReconciliacao = {
    iniciadoEm: new Date(inicio).toISOString(),
    concluidoEm: null,
    duracaoMs: null,
    completa,
    verificadas: 0,
    cobrancasEncontradas: 0,
    cobrancasNoProvedor: 0,
    ciclosNoLivro: 0,
    renovacoesPendentes: 0,
    falhasIds: [],
    mudaram: 0,
    ciclosNovos: 0,
    recusasNovas: 0,
    pendentesDeVinculo: 0,
    divergencias: 0,
    falhas: 0,
  };

  let cursor: string | undefined;

  for (;;) {
    const lote = await db.subscription.findMany({
      where: onde,
      orderBy: { id: "asc" },
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, userId: true, externalPreapprovalId: true },
    });
    if (lote.length === 0) break;

    for (const s of lote) {
      resumo.verificadas += 1;
      const preapprovalId = s.externalPreapprovalId!;

      try {
        const r = await reconciliarCicloDeAssinatura(preapprovalId, {
          origem: completa ? "varredura" : "reconciliacao",
        });

        if (r.mudou) resumo.mudaram += 1;
        resumo.ciclosNovos += r.ciclosNovos;
        resumo.recusasNovas += r.recusasNovas;
        resumo.cobrancasEncontradas += r.cobrancasEncontradas;
        if (r.renovacaoPendente) resumo.renovacoesPendentes += 1;

        if (r.vinculoLegadoPendente) {
          resumo.pendentesDeVinculo += 1;
          continue;
        }

        // Checagem cruzada: nunca corrige sozinha, só avisa.
        const c = r.conferencia;
        if (c) {
          resumo.cobrancasNoProvedor += c.cobrancasNoProvedor ?? 0;
          resumo.ciclosNoLivro += c.ciclosNoLivro;
        }
        if (c && c.cobrancasNoProvedor !== null && c.cobrancasNoProvedor !== c.ciclosNoLivro) {
          resumo.divergencias += 1;
          await log.warn({
            channel: "PAYMENTS",
            message: "Cobranças do provedor e ciclos do livro não batem",
            userId: s.userId,
            context: { subscriptionId: s.id, preapprovalId, ...c },
          });
        }
      } catch (erro) {
        resumo.falhas += 1;
        resumo.falhasIds.push(s.id);
        await log.error({
          channel: "PAYMENTS",
          message: "Reconciliação de assinatura falhou",
          userId: s.userId,
          context: {
            subscriptionId: s.id,
            preapprovalId,
            provedor: sanitizarFalha(erro),
          },
        });
      }
    }

    cursor = lote[lote.length - 1]!.id;
  }

  resumo.concluidoEm = new Date().toISOString();
  resumo.duracaoMs = Date.now() - inicio;

  // Uma linha por execução. INFO só quando há algo a ler — ciclo novo, recusa,
  // divergência, erro, vínculo pendente; execução sem novidade fica em DEBUG:
  // registrada, para provar que rodou, sem poluir o painel todo dia.
  //
  // `await`, e não `void`: numa função serverless a resposta pode sair antes
  // de um log solto terminar de gravar, e o registro da execução se perderia.
  const temNovidade =
    resumo.mudaram > 0 ||
    resumo.renovacoesPendentes > 0 ||
    resumo.divergencias > 0 ||
    resumo.falhas > 0 ||
    resumo.pendentesDeVinculo > 0;
  await (temNovidade ? log.info : log.debug)({
    channel: "JOBS",
    message:
      `Reconciliação de assinaturas (${completa ? "varredura completa" : "diária"}): ` +
      `${resumo.verificadas} verificada(s), ${resumo.cobrancasEncontradas} cobrança(s) encontrada(s), ` +
      `${resumo.ciclosNovos} ciclo(s) novo(s), ${resumo.renovacoesPendentes} renovação(ões) pendente(s), ` +
      `${resumo.divergencias} divergência(s), ` +
      `${resumo.falhas} erro(s)`,
    context: resumo,
  });

  return resumo;
}

// ------------------------------------------------- varredura do Pix mensal

/**
 * Por quanto tempo uma cobrança Pix continua sendo olhada depois de criada.
 *
 * O QR vale meia hora, mas o desfecho pode demorar mais que isso: pagamento em
 * análise, banco lento, e o caso que realmente importa — o Pix pago no último
 * segundo, cuja aprovação chega ao provedor **depois** de a nossa tentativa já
 * constar expirada. Dois dias cobrem isso com folga e não fazem a varredura
 * carregar o histórico inteiro todo dia.
 */
const JANELA_DO_PIX_MS = 2 * 86_400_000;

export type ResumoDoPix = {
  verificadas: number;
  ciclosNovos: number;
  encerradas: number;
  falhas: number;
};

/**
 * Descobre sozinha o que o webhook do Pix deveria ter contado.
 *
 * A reconciliação periódica de assinaturas parte de `externalPreapprovalId`, e
 * uma assinatura por Pix não tem nenhum — ela ficaria fora da rede inteira. É
 * esta varredura que a cobre, e ela existe pelo mesmo motivo que a outra:
 * **o webhook pode não chegar**, e quem pagou não pode depender disso.
 *
 * Inclui de propósito as tentativas já marcadas EXPIRED dentro da janela. O
 * Pix pago na virada do prazo é aprovado do lado deles com a nossa linha já
 * fechada; sem olhá-la de novo, o dinheiro entraria e o acesso não.
 * `reconciliarCicloManual` concede do mesmo jeito — a data do pagamento é que
 * decide o ciclo, não o estado em que a tentativa estava.
 */
export async function reconciliarPixPendentes(
  opcoes: { agora?: Date } = {},
): Promise<ResumoDoPix> {
  const agora = opcoes.agora ?? new Date();
  const resumo: ResumoDoPix = {
    verificadas: 0,
    ciclosNovos: 0,
    encerradas: 0,
    falhas: 0,
  };

  let cursor: string | undefined;

  for (;;) {
    const lote = await db.paymentAttempt.findMany({
      where: {
        kind: "SUBSCRIPTION",
        billingMode: "MANUAL_RENEW",
        status: { in: ["CREATED", "PENDING", "EXPIRED"] },
        externalId: { not: null },
        createdAt: { gte: new Date(agora.getTime() - JANELA_DO_PIX_MS) },
      },
      orderBy: { id: "asc" },
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, userId: true, externalId: true },
    });
    if (lote.length === 0) break;

    for (const t of lote) {
      resumo.verificadas += 1;
      try {
        // A porta de sempre. Ela reconsulta o provedor, decide, e é idempotente
        // — rodar junto com um webhook que chega agora converge no mesmo lugar.
        const r = await reconciliarPagamento(t.externalId!);
        // `reconciliarPagamento` devolve o resultado mais rico quando a
        // cobrança é de ciclo — que é sempre o caso aqui.
        resumo.ciclosNovos += (r as Partial<ResultadoDeCiclo>).ciclosNovos ?? 0;
        if (r.status === "EXPIRED" || r.status === "CANCELED") {
          resumo.encerradas += 1;
        }
      } catch (erro) {
        resumo.falhas += 1;
        await log.error({
          channel: "PAYMENTS",
          message: "Reconciliação de cobrança Pix falhou",
          userId: t.userId,
          context: { attemptId: t.id, provedor: sanitizarFalha(erro) },
        });
      }
    }

    cursor = lote[lote.length - 1]!.id;
  }

  return resumo;
}

/**
 * Marca o vencimento de quem renova à mão — sem cortar nada.
 *
 * O acesso durante a carência já é garantido pelo `graceUntil` gravado no
 * ciclo, e a expiração já o respeita. Isto aqui é o **fato datado**: a
 * assinatura passa a PAST_DUE e nasce um `SubscriptionEvent`, que é o que
 * permite dizer depois "quantas pessoas entraram em carência em outubro" e o
 * que um aviso por e-mail leria para não avisar duas vezes.
 *
 * `updateMany` condicionado ao status torna a operação repetível: o cron
 * rodando dez vezes grava um evento só.
 */
export async function marcarVencimentosManuais(
  agora: Date = new Date(),
): Promise<number> {
  const vencidas = await db.subscription.findMany({
    where: {
      billingMode: "MANUAL_RENEW",
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { not: null, lte: agora },
    },
    select: {
      id: true,
      userId: true,
      status: true,
      currentPeriodEnd: true,
      graceUntil: true,
    },
  });

  let marcadas = 0;

  for (const a of vencidas) {
    const mudou = await db.$transaction(async (tx) => {
      const { count } = await tx.subscription.updateMany({
        where: { id: a.id, status: a.status },
        data: {
          status: "PAST_DUE",
          // Já deve existir, gravado quando o ciclo foi concedido. O `??` é
          // para a linha que veio de antes desta fase e não tem nenhum.
          graceUntil:
            a.graceUntil ??
            fimDaCarencia(a.currentPeriodEnd!, CARENCIA_MANUAL_MS),
        },
      });
      if (count === 0) return false;

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: a.id,
          userId: a.userId,
          type: "PAST_DUE",
          fromStatus: a.status,
          toStatus: "PAST_DUE",
          periodEnd: a.currentPeriodEnd,
          payload: {
            origem: "cron",
            motivo: "carencia-de-renovacao-manual",
            billingMode: "MANUAL_RENEW",
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });

    if (mudou) marcadas += 1;
  }

  return marcadas;
}

async function aprovar(
  tx: Prisma.TransactionClient,
  tentativa: Tentativa,
  consulta: ConsultaPagamento,
  provedorNome: string,
): Promise<ResultadoReconciliacao> {
  // Cobrança de assinatura é assunto do livro de ciclos. Chegar aqui seria
  // gravar um `Payment` sem ciclo — que depois bloquearia o ciclo de verdade.
  if (tentativa.kind === "SUBSCRIPTION") {
    return {
      mudou: false,
      motivo: "cobrança de assinatura é tratada por reconciliarCicloDeAssinatura",
      attemptId: tentativa.id,
      status: consulta.status,
    };
  }

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

  return {
    mudou: false,
    motivo: "pagamento sem compra associada",
    attemptId: tentativa.id,
    status: consulta.status,
  };
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

  return {
    mudou: true,
    motivo: "pagamento recusado",
    attemptId: tentativa.id,
    status: consulta.status,
  };
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

  // Renovação manual não tem o que cancelar: ninguém vai cobrar de novo. Marcar
  // `cancelAtPeriodEnd` aqui gravaria um fato falso — e a tela passaria a dizer
  // "cancelada" para quem simplesmente tem um mês pago pela frente.
  if (assinatura.billingMode === "MANUAL_RENEW") {
    throw new ErroDeCobranca(
      "Seu plano não cobra nada automaticamente: ele vale até o vencimento e " +
        "só continua se você renovar. Não há o que cancelar.",
      "renovacao-manual",
    );
  }

  const externo = assinatura.externalPreapprovalId ?? assinatura.externalId;

  // O que o provedor confirmou. Sem preapproval não há lado de lá a confirmar
  // — assinatura de legado ou do provedor falso — e o cancelamento é local.
  let statusDoProvedor: EstadoProvedor | null = null;

  if (externo) {
    statusDoProvedor = await confirmarCancelamentoNoProvedor(
      externo,
      userId,
      assinatura.id,
    );
  }

  await db.$transaction([
    db.subscription.update({
      where: { userId },
      // `status` continua ACTIVE e `currentPeriodEnd` intocado: quem pagou até
      // o dia 30 assiste até o dia 30. O direito também não é revogado aqui —
      // ele expira sozinho no fim do ciclo.
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
        payload: {
          confirmadoPeloProvedor: statusDoProvedor === "CANCELED",
          providerStatus: statusDoProvedor,
          externalPreapprovalId: externo,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);

  void log.info({
    channel: "PAYMENTS",
    message: "Renovação cancelada e confirmada pelo provedor",
    userId,
    context: {
      subscriptionId: assinatura.id,
      externalPreapprovalId: externo,
      providerStatus: statusDoProvedor,
    },
  });

  return { ativoAte: assinatura.currentPeriodEnd };
}

/**
 * Cancela no provedor e **exige a confirmação dele** antes de deixar o
 * chamador gravar qualquer coisa.
 *
 * Antes, a falha era engolida num `catch` vazio: se o `PUT /preapproval`
 * quebrasse, o nosso banco dizia "cancelada" e o Mercado Pago seguia com a
 * assinatura viva — cobrando no ciclo seguinte, sem ninguém saber. Nada
 * reconsulta assinatura periodicamente, então a divergência duraria até a
 * próxima fatura.
 *
 * Duas voltas, e a segunda é o que torna a operação repetível: se o `PUT`
 * falhar — inclusive porque a assinatura **já estava** cancelada, caso em que
 * o provedor responde 400 — reconsultamos. Se a reconsulta disser CANCELED, o
 * desfecho desejado já é o vigente e seguimos em frente.
 *
 * Lança `ErroDeCobranca` quando não dá para confirmar. O chamador não grava, a
 * assinatura fica como está, e a pessoa pode tentar de novo.
 */
async function confirmarCancelamentoNoProvedor(
  externalId: string,
  userId: string,
  subscriptionId: string,
): Promise<EstadoProvedor> {
  const provedor = provedorDePagamento();
  let motivo: unknown = null;
  let status: EstadoProvedor | null = null;

  try {
    status = await provedor.cancelarAssinatura(externalId);
  } catch (erro) {
    motivo = erro;
  }

  if (status !== "CANCELED") {
    try {
      const consulta = await provedor.consultarAssinatura(externalId);
      status = consulta?.status ?? null;
    } catch (erro) {
      motivo = motivo ?? erro;
    }
  }

  if (status === "CANCELED") return status;

  // Campos escolhidos, não o corpo cru: `message`, `error`, `code`, `status`,
  // `cause` e o `x-request-id`. É o bastante para saber **por que** o provedor
  // recusou — um 400 sem isso é indiagnosticável, como a primeira tentativa
  // real provou — sem arrastar para a auditoria token, cabeçalho de
  // autorização ou dado de cartão.
  const detalhe = sanitizarFalha(motivo);

  void log.error({
    channel: "PAYMENTS",
    message: "Cancelamento recusado pelo provedor — assinatura preservada",
    userId,
    context: {
      subscriptionId,
      externalPreapprovalId: externalId,
      providerStatus: status,
      // O que foi enviado, para que o log baste sozinho na investigação.
      statusEnviado: "canceled",
      provedor: detalhe,
    },
  });

  throw new ErroDeCobranca(
    "O provedor de pagamento não confirmou o cancelamento. " +
      "Sua assinatura segue ativa e nada foi alterado — tente de novo em instantes.",
    "cancelamento-nao-confirmado",
  );
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
  opcoes: { ignorar?: string[] } = {},
): Promise<number> {
  const vencidas = await db.subscription.findMany({
    where: {
      ...(opcoes.ignorar?.length ? { id: { notIn: opcoes.ignorar } } : {}),
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
