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
  ehViolacaoDeUnicidade,
  revogarDireitos,
} from "@/lib/access/direitos";
import { db } from "@/lib/db";
import { log } from "@/lib/painel/log";

import { podeUsarMock, provedorDePagamento } from "./index";
import {
  fimDoCiclo,
  planoPorCodigo,
  PRECO_AVULSO_CENTS,
  type DefinicaoDePlano,
} from "./planos";
import { sanitizarFalha } from "./provedor";
import type {
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
      | "cancelamento-nao-confirmado",
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
  const preapprovalId =
    consulta.preapprovalId ??
    (tentativa?.kind === "SUBSCRIPTION" ? tentativa.externalId : null);

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
  preapprovalId: string;
  tentativa: Tentativa;
  plano: DefinicaoDePlano;
  provedorNome: string;
  opcoes: OpcoesDeCiclo;
};

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
  const semEfeito = { ciclosNovos: 0, recusasNovas: 0, cobrancasEncontradas: 0 };

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
  const faturas = (await provedor.listarFaturas(preapprovalId))
    .filter(
      (f) =>
        f.pagamento &&
        (!f.preapprovalId || f.preapprovalId === preapprovalId),
    )
    .sort(porOrdemDeDebito);

  let ciclosNovos = 0;
  let recusasNovas = 0;

  try {
    for (const fatura of faturas) {
      const status = fatura.pagamento!.status;
      if (status === "APPROVED") {
        if (await registrarCobrancaAprovada(ctx, fatura)) ciclosNovos += 1;
      } else if (status === "REJECTED" || status === "CANCELED") {
        if (await registrarCobrancaRecusada(ctx, fatura)) recusasNovas += 1;
      }
    }
  } catch (erro) {
    if (erro instanceof VinculoLegadoPendente) return pendente;
    throw erro;
  }

  const estadoMudou = await aplicarEstadoDoPreapproval(ctx, pre.status, pre.statusCru ?? null);

  const ciclosNoLivro = await db.payment.count({
    where: {
      attemptId: tentativa.id,
      cycleIndex: { not: null },
      status: "APPROVED",
    },
  });

  const mudou = ciclosNovos > 0 || recusasNovas > 0 || estadoMudou;

  return {
    mudou,
    motivo: mudou
      ? `ciclos novos: ${ciclosNovos}, recusas novas: ${recusasNovas}` +
        (estadoMudou ? ", estado do preapproval aplicado" : "")
      : "nada novo no provedor",
    attemptId: tentativa.id,
    status: pre.status,
    snapshot: pre,
    ciclosNovos,
    recusasNovas,
    cobrancasEncontradas: faturas.length,
    conferencia: {
      cobrancasNoProvedor: pre.cobrancasRealizadas ?? null,
      ciclosNoLivro,
    },
  };
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
    };
  }

  return reconciliarCicloDeAssinatura(fatura.preapprovalId, {
    origem: "webhook:subscription_authorized_payment",
  });
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
  fatura: FaturaDeAssinatura,
  subscriptionId: string | null,
) {
  return {
    userId: ctx.tentativa.userId,
    subscriptionId,
    invoiceId: fatura.id,
    kind: "SUBSCRIPTION" as const,
    plan: ctx.plano.code,
    amountCents: fatura.valorCents,
    currency: fatura.moeda,
    provider: ctx.provedorNome,
    externalId: fatura.pagamento!.id,
    method: fatura.metodo,
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
  fatura: FaturaDeAssinatura,
): Promise<boolean> {
  return comConflitoIdempotente(fatura.pagamento!.id, ctx.provedorNome, false, () =>
    db.$transaction((tx) => concederCiclo(tx, ctx, fatura)),
  );
}

async function concederCiclo(
  tx: Prisma.TransactionClient,
  ctx: ContextoDeCiclo,
  fatura: FaturaDeAssinatura,
): Promise<boolean> {
  const { tentativa, plano, preapprovalId, opcoes } = ctx;
  const pagamentoId = fatura.pagamento!.id;
  const cobradoEm = fatura.dataDebito ?? new Date();

  const assinatura =
    (await tx.subscription.findUnique({ where: { userId: tentativa.userId } })) ??
    (await tx.subscription.create({
      data: { userId: tentativa.userId, plan: "FREE", status: "ACTIVE" },
    }));

  const papel = await papelDoPreapproval(tx, assinatura, ctx);

  if (papel === "antigo") {
    // Dinheiro que entrou é receita e fica registrado — mas não é deste
    // preapproval que o acesso depende, então não move data nenhuma.
    await tx.payment.create({
      data: { ...dadosDaCobranca(ctx, fatura, assinatura.id), status: "APPROVED" },
    });
    return false;
  }

  const ultimo = await tx.payment.findFirst({
    where: { subscriptionId: assinatura.id, cycleIndex: { not: null } },
    orderBy: { cycleIndex: "desc" },
  });
  const cycleIndex = (ultimo?.cycleIndex ?? 0) + 1;

  const legado =
    papel === "atual" &&
    !ultimo &&
    PLANOS_PAGOS.includes(assinatura.plan) &&
    assinatura.currentPeriodEnd !== null;

  if (legado) {
    if (!opcoes.permitirVinculoLegado) throw new VinculoLegadoPendente();

    // O ciclo 1 já foi concedido pelo caminho antigo. Vincular é só dizer qual
    // cobrança o pagou: nenhuma data se move, nada de cancelamento muda.
    await tx.payment.create({
      data: {
        ...dadosDaCobranca(ctx, fatura, assinatura.id),
        status: "APPROVED",
        cycleIndex,
        periodStart: assinatura.currentPeriodStart ?? cobradoEm,
        periodEnd: assinatura.currentPeriodEnd,
      },
    });
    return true;
  }

  // Renovação encadeia no fim do ciclo anterior — não em "hoje" —, e é isso
  // que torna o resultado igual em qualquer ordem de chegada. Assinatura nova
  // começa na cobrança, sem apagar dias que a pessoa ainda tinha pagos.
  let inicio: Date;
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
  const fim = fimDoCiclo(plano, inicio);

  // Primeira escrita da transação, de propósito: se a unicidade disparar, nada
  // mais foi tocado.
  await tx.payment.create({
    data: {
      ...dadosDaCobranca(ctx, fatura, assinatura.id),
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
      externalPreapprovalId: preapprovalId,
      currentPeriodStart: inicio,
      currentPeriodEnd: fimVigente,
      failedCharges: 0,
      graceUntil: null,
      // Só uma assinatura NOVA limpa um cancelamento. Cobrança do preapproval
      // vigente — atrasada, reentregue, retentativa — nunca desfaz o pedido
      // de quem cancelou.
      ...(papel === "novo"
        ? { startedAt: inicio, cancelAtPeriodEnd: false, canceledAt: null }
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
        invoiceId: fatura.id,
        cycleIndex,
      } as Prisma.InputJsonValue,
    },
  });

  // A tentativa original só muda de status na ativação, e nunca de id: ela é
  // o checkout que a pessoa fez, não a última cobrança do ciclo.
  if (papel === "novo" && tentativa.status !== "APPROVED") {
    await tx.paymentAttempt.update({
      where: { id: tentativa.id },
      data: { status: "APPROVED", rawStatus: "authorized" },
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
  fatura: FaturaDeAssinatura,
): Promise<boolean> {
  return comConflitoIdempotente(fatura.pagamento!.id, ctx.provedorNome, false, () =>
    db.$transaction(async (tx) => {
      const pagamento = fatura.pagamento!;
      const assinatura = await tx.subscription.findUnique({
        where: { userId: ctx.tentativa.userId },
      });

      await tx.payment.create({
        data: {
          ...dadosDaCobranca(ctx, fatura, assinatura?.id ?? null),
          status: "FAILED",
          failureCode: pagamento.detalheCru,
          failureMessage: pagamento.statusCru,
        },
      });

      if (!assinatura) return true;
      if ((await papelDoPreapproval(tx, assinatura, ctx)) !== "atual") return true;

      const faturaPaga = await tx.payment.findFirst({
        where: { invoiceId: fatura.id, status: "APPROVED" },
        select: { id: true },
      });
      if (faturaPaga) return true;

      const base =
        assinatura.currentPeriodEnd ?? fatura.dataDebito ?? new Date();

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
            paymentId: pagamento.id,
            invoiceId: fatura.id,
            detalhe: pagamento.detalheCru,
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

  const onde: Prisma.SubscriptionWhereInput = completa
    ? {
        externalPreapprovalId: { not: null },
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      }
    : {
        externalPreapprovalId: { not: null },
        OR: [
          { status: "PAST_DUE" },
          { failedCharges: { gt: 0 } },
          { graceUntil: { not: null } },
          {
            status: { in: ["ACTIVE", "TRIALING"] },
            currentPeriodEnd: { lte: limite },
          },
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
    resumo.divergencias > 0 ||
    resumo.falhas > 0 ||
    resumo.pendentesDeVinculo > 0;
  await (temNovidade ? log.info : log.debug)({
    channel: "JOBS",
    message:
      `Reconciliação de assinaturas (${completa ? "varredura completa" : "diária"}): ` +
      `${resumo.verificadas} verificada(s), ${resumo.cobrancasEncontradas} cobrança(s) encontrada(s), ` +
      `${resumo.ciclosNovos} ciclo(s) novo(s), ${resumo.divergencias} divergência(s), ` +
      `${resumo.falhas} erro(s)`,
    context: resumo,
  });

  return resumo;
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
