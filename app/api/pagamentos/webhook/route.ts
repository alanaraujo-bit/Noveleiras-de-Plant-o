import { NextResponse } from "next/server";

import { provedorDePagamento } from "@/lib/pagamentos";
import { receberWebhook } from "@/lib/pagamentos/webhook";

/**
 * Recepção de webhooks do provedor de pagamento.
 *
 * As regras — só Webhook com HMAC válida é processado, IPN legado é gravado e
 * ignorado, tentativa não validada nunca bloqueia a reentrega válida, falha
 * nossa responde 500 e é reprocessada — moram em `lib/pagamentos/webhook.ts`,
 * onde são testadas. Aqui só se traduz o resultado em resposta HTTP.
 *
 * Tópicos processados hoje (formato Webhook):
 *
 *   payment                          cobrança avulsa ou de ciclo
 *   merchant_order                   pedido do Checkout Pro
 *   subscription_authorized_payment  cobrança de um ciclo da recorrência
 *   preapproval                      assinatura autorizada, pausada, cancelada
 *   subscription_preapproval         idem, nome alternativo do mesmo recurso
 *
 * Qualquer outro é gravado como `IGNORED` e responde 200 — recusar o
 * desconhecido só provocaria reentrega infinita de algo que não nos diz
 * respeito.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // Corpo cru: reserializar o JSON mudaria espaços e ordem de chaves.
  const corpoCru = await request.text();

  const { status, corpo } = await receberWebhook(
    provedorDePagamento(),
    corpoCru,
    request.headers,
    new URL(request.url),
  );

  return NextResponse.json(corpo, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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
