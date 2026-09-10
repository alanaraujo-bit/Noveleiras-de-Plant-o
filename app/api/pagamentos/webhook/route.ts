import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { provedorDePagamento } from "@/lib/pagamentos";
import {
  reconciliarAssinatura,
  reconciliarPagamento,
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
 * `subscription_authorized_payment` está aqui, e não entre os de assinatura,
 * porque o `data.id` desse tópico é o id de uma **cobrança** de ciclo — não o
 * do `preapproval`. Mandá-lo para `/preapproval/<id>` devolveria 404, o
 * evento viraria "ignorado" e a renovação nunca estenderia o acesso, em
 * silêncio.
 */
const TOPICOS_DE_PAGAMENTO = new Set([
  "payment",
  "merchant_order",
  "subscription_authorized_payment",
]);

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

  if (TOPICOS_DE_PAGAMENTO.has(topico)) {
    const resultado = await reconciliarPagamento(recursoId);
    return { tratado: true, snapshot: resultado };
  }

  if (TOPICOS_DE_ASSINATURA.has(topico)) {
    // Mesma rotina que a página de retorno e a tela de espera chamam. Havendo
    // um só caminho, não existe o desfecho em que um deles ativa a assinatura
    // e o outro só carimba a tentativa.
    const resultado = await reconciliarAssinatura(recursoId);
    return { tratado: resultado.mudou, snapshot: resultado.snapshot };
  }

  return { tratado: false };
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
