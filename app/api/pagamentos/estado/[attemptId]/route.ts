import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  reconciliarAssinatura,
  reconciliarPagamento,
} from "@/lib/pagamentos/servico";

/**
 * Estado de uma cobrança. A tela de checkout consulta isto enquanto espera.
 *
 * Duas coisas que este endpoint faz de propósito:
 *
 * 1. **Confere a posse.** A tentativa precisa ser de quem está pedindo. Sem
 *    isso, trocar o id na URL leria o pagamento alheio — é o exemplo clássico
 *    de referência direta insegura, e o id de tentativa é justamente o que
 *    aparece no navegador de quem paga.
 *
 * 2. **Reconsulta o provedor**, em vez de devolver o que temos gravado. O
 *    Pix é o caso comum: a pessoa paga no aplicativo do banco e nada nos
 *    avisa até o webhook chegar. Reconsultar aqui faz a tela virar sozinha,
 *    e como `reconciliarPagamento` é idempotente, isso não conflita com o
 *    webhook que chega depois — os dois convergem para o mesmo estado.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  const { attemptId } = await params;
  const tentativa = await db.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      userId: true,
      status: true,
      kind: true,
      plan: true,
      novelaId: true,
      externalId: true,
      amountCents: true,
      method: true,
      checkoutUrl: true,
      pixQrCode: true,
      expiresAt: true,
      failureMessage: true,
      rawStatus: true,
    },
  });

  // 404, e não 403, quando é de outra pessoa: responder "existe mas não é seu"
  // confirmaria a existência do id para quem está sondando.
  if (!tentativa || tentativa.userId !== viewer.id) {
    return NextResponse.json(
      { erro: "Cobrança não encontrada." },
      { status: 404 },
    );
  }

  let status = tentativa.status;

  if (
    (status === "PENDING" || status === "CREATED") &&
    tentativa.externalId
  ) {
    try {
      // Assinatura e compra são objetos diferentes no provedor. Mandar um id
      // de `preapproval` para a consulta de pagamento devolvia 404, a rota não
      // fazia nada, e a tela girava para sempre sem nunca liberar o acesso.
      const resultado =
        tentativa.kind === "SUBSCRIPTION"
          ? await reconciliarAssinatura(tentativa.externalId)
          : await reconciliarPagamento(tentativa.externalId);
      if (resultado.attemptId) {
        const atualizada = await db.paymentAttempt.findUnique({
          where: { id: tentativa.id },
          select: { status: true },
        });
        status = atualizada?.status ?? status;
      }
    } catch (erro) {
      // Falha ao reconsultar não pode derrubar a tela: o webhook ainda vai
      // chegar, e a próxima consulta tenta de novo.
      console.error("[estado] reconciliação falhou", erro);
    }
  }

  return NextResponse.json(
    {
      id: tentativa.id,
      status,
      tipo: tentativa.kind,
      plano: tentativa.plan,
      novelaId: tentativa.novelaId,
      valorCents: tentativa.amountCents,
      metodo: tentativa.method,
      checkoutUrl: tentativa.checkoutUrl,
      pixQrCode: tentativa.pixQrCode,
      expiraEm: tentativa.expiresAt?.toISOString() ?? null,
      mensagem: tentativa.failureMessage,
      motivoCru: tentativa.rawStatus,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
