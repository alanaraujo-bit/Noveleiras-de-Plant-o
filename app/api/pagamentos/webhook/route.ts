import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { provedorDePagamento } from "@/lib/pagamentos";
import {
  reconciliarCicloDeAssinatura,
  reconciliarFatura,
  reconciliarMerchantOrder,
  reconciliarPagamento,
  type ResultadoDeCiclo,
  type ResultadoReconciliacao,
} from "@/lib/pagamentos/servico";

/**
 * Recepção de webhooks do provedor de pagamento.
 *
 * Quatro regras governam este arquivo, e cada uma existe por causa de uma
 * forma conhecida de perder dinheiro ou vazar conteúdo:
 *
 * 1. **O corpo do webhook nunca autoriza nada.** Ele só diz "o recurso X
 *    mudou". Quem decide é a releitura autenticada em `reconciliarPagamento`
 *    ou `reconciliarAssinatura`.
 *    Confiar no corpo significaria que qualquer um com a URL — que é pública
 *    por definição — poderia liberar o catálogo inteiro com um `curl`.
 *
 * 2. **Todo evento é gravado, válido ou não.** A unicidade
 *    `(provider, eventId)` faz a idempotência, e a assinatura inválida fica
 *    registrada em vez de descartada em silêncio: tentativa de forjar webhook
 *    é exatamente o que se quer poder auditar depois.
 *
 * 3. **Responder 200 rápido.** O Mercado Pago reentrega o que demora, e uma
 *    reentrega em cima de um processamento ainda rodando é a receita da
 *    condição de corrida. Erro nosso responde 500 de propósito, para que eles
 *    reentreguem — a idempotência torna isso seguro.
 *
 * 4. **Nunca vazar detalhe interno na resposta.** O corpo é mínimo.
 *
 * Tópicos tratados hoje:
 *
 *   payment                        cobrança avulsa ou de ciclo
 *   merchant_order                 pedido do Checkout Pro
 *   subscription_authorized_payment  cobrança de um ciclo da recorrência
 *   preapproval                    assinatura autorizada, pausada, cancelada
 *   subscription_preapproval       idem, nome alternativo do mesmo recurso
 *
 * Qualquer outro é gravado como `IGNORED` e responde 200 — recusar o
 * desconhecido só provocaria reentrega infinita de algo que não nos diz
 * respeito.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `subscription_authorized_payment` **não** é pagamento. O `data.id` dele é
 * o id de uma fatura: confirmado contra a API real, `GET /v1/payments/<id da
 * fatura>` responde 404 — e era para lá que este tópico ia, então toda
 * renovação notificada virava "ignorado" em silêncio.
 */
const TOPICOS_DE_PAGAMENTO = new Set(["payment"]);

const TOPICOS_DE_ASSINATURA = new Set([
  "preapproval",
  "subscription_preapproval",
]);

export async function POST(request: Request) {
  const provedor = provedorDePagamento();

  // Corpo cru: a assinatura HMAC é calculada sobre bytes. Reserializar o JSON
  // mudaria espaços e ordem de chaves, e a conferência falharia sempre.
  const corpoCru = await request.text();
  const url = new URL(request.url);

  let lido;
  try {
    lido = await provedor.lerWebhook(corpoCru, request.headers, url);
  } catch (erro) {
    // Sem credencial configurada não dá nem para validar. Registrar seria
    // gravar lixo não verificável; 503 faz o provedor tentar de novo depois.
    return NextResponse.json(
      { erro: "webhook indisponível" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // A gravação é a trava de idempotência. Se o evento já existe, esta criação
  // falha por unicidade — e é isso, e não um `if` em memória, que impede duas
  // entregas simultâneas de serem processadas em paralelo.
  let eventoId: string;
  try {
    const evento = await db.webhookEvent.create({
      data: {
        provider: provedor.nome,
        eventId: lido.eventId,
        topic: lido.topico,
        action: lido.acao,
        signatureValid: lido.assinaturaValida,
        resourceId: lido.recursoId,
        status: "RECEIVED",
        payload: lido.payload as Prisma.InputJsonValue,
      },
    });
    eventoId = evento.id;
  } catch {
    // Já recebido. Responder 200 encerra a reentrega sem repetir efeito.
    return NextResponse.json(
      { ok: true, duplicado: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!lido.assinaturaValida) {
    await db.webhookEvent.update({
      where: { id: eventoId },
      data: {
        status: "FAILED",
        error: "assinatura invalida",
        processedAt: new Date(),
      },
    });
    // 401 e nada mais: não confirmamos se o recurso existe, para não
    // transformar o endpoint em oráculo para quem está sondando.
    return NextResponse.json(
      { erro: "assinatura inválida" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
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
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    await db.webhookEvent.update({
      where: { id: eventoId },
      data: {
        status: "FAILED",
        error: erro instanceof Error ? erro.message : String(erro),
        attempts: { increment: 1 },
      },
    });

    // 500 de propósito: queremos a reentrega. A linha já gravada garante que
    // ela não duplique efeito.
    return NextResponse.json(
      { erro: "falha ao processar" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
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
    // `/v1/payments` devolvia 404, e o ramo abaixo gravava `tratado: true`
    // mesmo assim — o evento constava PROCESSED tendo feito nada.
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

/**
 * O Mercado Pago valida a URL com um GET antes de ativar a notificação.
 * Responder 200 aqui é o que permite cadastrar o endereço no painel deles.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, servico: "webhook de pagamentos" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
