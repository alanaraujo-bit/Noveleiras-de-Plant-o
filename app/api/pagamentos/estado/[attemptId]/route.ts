import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  reconciliarAssinatura,
  reconciliarCompra,
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
      billingMode: true,
      novelaId: true,
      externalId: true,
      externalPreferenceId: true,
      externalMerchantOrderId: true,
      amountCents: true,
      method: true,
      checkoutUrl: true,
      pixQrCode: true,
      pixQrCodeBase64: true,
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

  // Assinatura por cartão precisa do `preapproval`; assinatura por Pix e
  // compra partem do pagamento — e a compra ainda aceita a preferência ou o
  // pedido, que é o que permite recuperar quem fechou a aba do Mercado Pago
  // sem nunca passar pela `back_url`.
  const recorrente =
    tentativa.kind === "SUBSCRIPTION" &&
    tentativa.billingMode !== "MANUAL_RENEW";

  const temPorOndeComecar = recorrente
    ? Boolean(tentativa.externalId)
    : Boolean(
        tentativa.externalId ??
          tentativa.externalPreferenceId ??
          tentativa.externalMerchantOrderId,
      );

  // EXPIRED entra na releitura só no Pix mensal, e por um motivo concreto: um
  // Pix pago na virada do prazo é aprovado do lado deles com a nossa linha já
  // fechada. Sem isto, a tela ficaria dizendo "expirou" a quem pagou — o cron
  // consertaria em algumas horas, tarde demais para quem está olhando agora.
  const pixManual =
    tentativa.kind === "SUBSCRIPTION" &&
    tentativa.billingMode === "MANUAL_RENEW";

  const vaiReconsultar =
    status === "PENDING" ||
    status === "CREATED" ||
    (pixManual && status === "EXPIRED");

  if (vaiReconsultar && temPorOndeComecar) {
    try {
      // Contrato, cobrança de ciclo e compra são objetos diferentes no
      // provedor. Mandar um id de `preapproval` — ou de preferência — para a
      // consulta de pagamento devolvia 404, a rota não fazia nada, e a tela
      // girava para sempre.
      const resultado = recorrente
        ? await reconciliarAssinatura(tentativa.externalId as string)
        : tentativa.kind === "SUBSCRIPTION"
          ? // Ciclo mensal por Pix: o `externalId` **é** o pagamento.
            await reconciliarPagamento(tentativa.externalId as string)
          : await reconciliarCompra(tentativa.id);
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

  // "Seu Plantão está liberado até 11 de outubro" é a única coisa que a pessoa
  // quer ler depois de pagar, e ela precisa vir do servidor: o cliente não tem
  // como saber onde o ciclo terminou — quem renovou antes do vencimento ganhou
  // dias encadeados, quem pagou na carência não ganhou nenhum.
  const aprovadaDeAssinatura =
    status === "APPROVED" && tentativa.kind === "SUBSCRIPTION";

  const [assinaturaAtual, cobrancaDoCiclo] = aprovadaDeAssinatura
    ? await Promise.all([
        db.subscription.findUnique({
          where: { userId: viewer.id },
          select: { currentPeriodEnd: true },
        }),
        // Qual mês esta cobrança pagou. É o que separa "Pagamento aprovado" de
        // "Renovação concluída" — e o cliente não tem como saber, porque uma
        // renovação antecipada é indistinguível de uma estreia do lado dele.
        db.payment.findFirst({
          where: {
            attemptId: tentativa.id,
            cycleIndex: { not: null },
            status: "APPROVED",
          },
          orderBy: { cycleIndex: "desc" },
          select: { cycleIndex: true },
        }),
      ])
    : [null, null];

  const liberadoAte = assinaturaAtual?.currentPeriodEnd ?? null;

  return NextResponse.json(
    {
      id: tentativa.id,
      status,
      tipo: tentativa.kind,
      plano: tentativa.plan,
      // Cartão ou Pix mudam o que a tela diz sobre o **próximo** mês; o
      // benefício é o mesmo nos dois.
      renovacao: tentativa.billingMode,
      novelaId: tentativa.novelaId,
      valorCents: tentativa.amountCents,
      metodo: tentativa.method,
      checkoutUrl: tentativa.checkoutUrl,
      pixQrCode: tentativa.pixQrCode,
      pixQrCodeBase64: tentativa.pixQrCodeBase64,
      expiraEm: tentativa.expiresAt?.toISOString() ?? null,
      liberadoAte: liberadoAte?.toISOString() ?? null,
      ciclo: cobrancaDoCiclo?.cycleIndex ?? null,
      mensagem: tentativa.failureMessage,
      motivoCru: tentativa.rawStatus,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
