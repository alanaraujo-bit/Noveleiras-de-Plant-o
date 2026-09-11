/**
 * Recepção de notificações do provedor de pagamento.
 *
 * Mora em `lib/` e não na rota para ser testável sem um servidor de pé; a
 * rota só traduz o resultado em `NextResponse`.
 *
 * As regras, e a forma de perder dinheiro ou vazar conteúdo que cada uma
 * impede:
 *
 * 1. **O corpo nunca autoriza nada.** Ele só diz "o recurso X mudou". Quem
 *    decide é a releitura autenticada em `reconciliar*`. Confiar no corpo
 *    significaria que qualquer um com a URL — pública por definição —
 *    poderia liberar o catálogo inteiro com um `curl`.
 *
 * 2. **Só Webhook com HMAC válida é processado.** IPN legado não tem a
 *    assinatura do Webhook: é gravado como `IGNORED`, responde 200 para
 *    encerrar a reentrega e não toca em Payment, Subscription, Entitlement
 *    nem Purchase. Preapprovals e preferências antigas ainda mandam IPN; a
 *    reconciliação periódica cobre o que ele avisaria.
 *
 * 3. **Tentativa não validada nunca ocupa a chave de idempotência.** Ela é
 *    gravada com `eventId` sintético e o id alegado em `claimedEventId`: cada
 *    tentativa fica auditável, e nenhuma bloqueia a reentrega válida do mesmo
 *    evento. A unicidade `(provider, eventId)` vale só para evento validado.
 *
 * 4. **Falha nossa não vira sucesso definitivo.** Erro ao processar grava
 *    `FAILED` e responde 500 para provocar reentrega — e a reentrega
 *    reivindica a linha em vez de esbarrar nela como "duplicada".
 *
 * 5. **Nunca vazar detalhe interno na resposta**, nem gravar o valor de
 *    `x-signature`, `v1`, segredo ou token.
 */

import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import type { ProvedorDePagamento, WebhookLido } from "./provedor";
import {
  reconciliarCicloDeAssinatura,
  reconciliarFatura,
  reconciliarMerchantOrder,
  reconciliarPagamento,
  type ResultadoDeCiclo,
  type ResultadoReconciliacao,
} from "./servico";

export type RespostaDoWebhook = {
  status: number;
  corpo: Record<string, unknown>;
};

/**
 * Uma linha `RECEIVED` mais velha que isto é de uma execução que morreu no
 * meio (timeout, deploy). Sem esse prazo ela ficaria presa para sempre, e a
 * reentrega seria tratada como duplicada.
 */
export const RECEBIDO_ORFAO_MS = 5 * 60_000;

/**
 * `subscription_authorized_payment` **não** é pagamento. O `data.id` dele é
 * o id de uma fatura: confirmado contra a API real, `GET /v1/payments/<id da
 * fatura>` responde 404.
 */
const TOPICOS_DE_PAGAMENTO = new Set(["payment"]);

const TOPICOS_DE_ASSINATURA = new Set([
  "preapproval",
  "subscription_preapproval",
]);

export async function receberWebhook(
  provedor: ProvedorDePagamento,
  corpoCru: string,
  cabecalhos: Headers,
  url: URL,
): Promise<RespostaDoWebhook> {
  let lido: WebhookLido;
  try {
    lido = await provedor.lerWebhook(corpoCru, cabecalhos, url);
  } catch {
    // Sem credencial configurada não dá nem para validar. Registrar seria
    // gravar lixo não verificável; 503 faz o provedor tentar de novo depois.
    return { status: 503, corpo: { erro: "webhook indisponível" } };
  }

  if (lido.formato === "IPN") {
    await gravarNaoValidado(provedor.nome, lido, "ipn", {
      status: "IGNORED",
      error: "ipn legado: ignorado",
      processedAt: new Date(),
    });
    return { status: 200, corpo: { ok: true, ignorado: true } };
  }

  if (!lido.assinaturaValida) {
    await gravarNaoValidado(provedor.nome, lido, "rejeitado", {
      status: "FAILED",
      error: "assinatura invalida",
      processedAt: new Date(),
    });
    // 401 e nada mais: não confirmamos se o recurso existe, para não
    // transformar o endpoint em oráculo para quem está sondando.
    return { status: 401, corpo: { erro: "assinatura inválida" } };
  }

  const eventoId = await reivindicar(provedor.nome, lido);
  if (!eventoId) {
    // Já processado, ou outra entrega do mesmo evento está em andamento.
    return { status: 200, corpo: { ok: true, duplicado: true } };
  }

  try {
    const resultado = await processar(lido.topico, lido.recursoId);

    await db.webhookEvent.update({
      where: { id: eventoId },
      data: {
        status: resultado.tratado ? "PROCESSED" : "IGNORED",
        providerSnapshot: (resultado.snapshot ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        error: null,
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    return { status: 200, corpo: { ok: true } };
  } catch (erro) {
    await db.webhookEvent.update({
      where: { id: eventoId },
      data: {
        status: "FAILED",
        error: erro instanceof Error ? erro.message : String(erro),
        attempts: { increment: 1 },
      },
    });

    // 500 de propósito: queremos a reentrega, e ela vai reivindicar esta
    // linha em `reivindicar`.
    return { status: 500, corpo: { erro: "falha ao processar" } };
  }
}

/** Grava para auditoria, fora da chave de idempotência. Nunca é processado. */
async function gravarNaoValidado(
  provider: string,
  lido: WebhookLido,
  prefixo: "ipn" | "rejeitado",
  desfecho: {
    status: "IGNORED" | "FAILED";
    error: string;
    processedAt: Date;
  },
): Promise<void> {
  await db.webhookEvent.create({
    data: {
      provider,
      eventId: `${prefixo}:${randomUUID()}`,
      claimedEventId: lido.eventId,
      format: lido.formato,
      topic: lido.topico,
      action: lido.acao,
      signatureValid: false,
      resourceId: lido.recursoId,
      diagnostics: lido.diagnostico as Prisma.InputJsonValue,
      payload: lido.payload as Prisma.InputJsonValue,
      ...desfecho,
    },
  });
}

function violouUnicidade(erro: unknown): boolean {
  return (erro as { code?: unknown } | null)?.code === "P2002";
}

/**
 * Obtém a linha de um evento **validado** para processá-lo, ou `null` se ele
 * não deve ser processado agora.
 *
 * A criação é a trava: duas entregas simultâneas não passam as duas, porque
 * a unicidade `(provider, eventId)` barra a segunda no banco. Quando barra, a
 * linha existente decide:
 *
 *   PROCESSED / IGNORED     duplicata legítima → `null`
 *   RECEIVED recente        outra entrega em andamento → `null`
 *   FAILED / RECEIVED órfão reivindica, por atualização condicional: só uma
 *                           reentrega concorrente consegue
 *   signatureValid = false  linha anterior à separação, ocupando o id real;
 *                           sai do caminho (auditoria preservada) e tenta
 *                           criar de novo
 */
async function reivindicar(
  provider: string,
  lido: WebhookLido,
): Promise<string | null> {
  const diagnostics = lido.diagnostico as Prisma.InputJsonValue;

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const evento = await db.webhookEvent.create({
        data: {
          provider,
          eventId: lido.eventId,
          format: lido.formato,
          topic: lido.topico,
          action: lido.acao,
          signatureValid: true,
          resourceId: lido.recursoId,
          diagnostics,
          status: "RECEIVED",
          payload: lido.payload as Prisma.InputJsonValue,
        },
      });
      return evento.id;
    } catch (erro) {
      // Qualquer outra falha é nossa: sobe, vira 500 e o provedor reentrega.
      if (!violouUnicidade(erro)) throw erro;
    }

    const existente = await db.webhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: lido.eventId } },
    });
    if (!existente) continue;

    if (!existente.signatureValid) {
      await db.webhookEvent.updateMany({
        where: { id: existente.id, signatureValid: false },
        data: {
          eventId: `rejeitado:${existente.id}`,
          claimedEventId: existente.eventId,
        },
      });
      continue;
    }

    const orfao =
      existente.status === "RECEIVED" &&
      existente.updatedAt.getTime() < Date.now() - RECEBIDO_ORFAO_MS;

    if (existente.status === "FAILED" || orfao) {
      const { count } = await db.webhookEvent.updateMany({
        where: {
          id: existente.id,
          status: existente.status,
          updatedAt: existente.updatedAt,
        },
        data: { status: "RECEIVED", error: null, diagnostics },
      });
      return count === 1 ? existente.id : null;
    }

    return null;
  }

  return null;
}

type Processamento = { tratado: boolean; snapshot?: unknown };

async function processar(
  topico: string,
  recursoId: string | null,
): Promise<Processamento> {
  if (!recursoId) return { tratado: false };

  if (topico === "subscription_authorized_payment") {
    const resultado = await reconciliarFatura(recursoId);
    return { tratado: foiTratado(resultado), snapshot: resultado };
  }

  if (topico === "merchant_order") {
    // O id aqui é o do **pedido**, não o do pagamento. Mandá-lo para
    // `/v1/payments` devolvia 404, e o evento constava PROCESSED tendo feito
    // nada.
    const resultado = await reconciliarMerchantOrder(recursoId);
    return { tratado: resultado.mudou, snapshot: resultado };
  }

  if (TOPICOS_DE_PAGAMENTO.has(topico)) {
    // Cobrança de assinatura é desviada lá dentro para o livro de ciclos.
    const resultado = await reconciliarPagamento(recursoId);
    return { tratado: foiTratado(resultado), snapshot: resultado };
  }

  if (TOPICOS_DE_ASSINATURA.has(topico)) {
    // Mesma rotina do retorno, da tela de espera e do cron.
    const resultado = await reconciliarCicloDeAssinatura(recursoId, {
      origem: `webhook:${topico}`,
    });
    return { tratado: foiTratado(resultado), snapshot: resultado };
  }

  return { tratado: false };
}

/**
 * PROCESSED quer dizer "reconciliado contra uma cobrança nossa", mesmo que a
 * reconciliação não tenha tido nada novo a fazer — reentrega é isso. IGNORED
 * fica para o que não nos diz respeito, e para a assinatura antiga que ainda
 * espera a migração do livro de ciclos: esse evento precisa poder ser
 * reprocessado depois.
 */
function foiTratado(
  resultado: ResultadoReconciliacao | ResultadoDeCiclo,
): boolean {
  if ("vinculoLegadoPendente" in resultado && resultado.vinculoLegadoPendente) {
    return false;
  }
  return resultado.attemptId !== null;
}
