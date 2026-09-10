import { notFound, redirect } from "next/navigation";

import { EstadoDoPagamento } from "@/components/pagamento/EstadoDoPagamento";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { planoPorCodigo } from "@/lib/pagamentos/planos";

export const metadata = { title: "Pagamento" };
export const dynamic = "force-dynamic";

/**
 * Acompanhamento de uma cobrança.
 *
 * A posse é conferida aqui, no servidor, antes de renderizar qualquer coisa:
 * a tentativa precisa ser de quem está pedindo. `notFound()` em vez de um
 * "acesso negado" porque confirmar que o id existe já seria informação demais
 * para quem está sondando ids alheios.
 */
export default async function PagamentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ destino?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const { attemptId } = await params;
  const { destino } = await searchParams;

  const tentativa = await db.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      userId: true,
      status: true,
      kind: true,
      plan: true,
      amountCents: true,
      method: true,
      checkoutUrl: true,
      pixQrCode: true,
      expiresAt: true,
      failureMessage: true,
      rawStatus: true,
      novelaId: true,
    },
  });

  if (!tentativa || tentativa.userId !== viewer.id) notFound();

  const novela = tentativa.novelaId
    ? await db.novela.findUnique({
        where: { id: tentativa.novelaId },
        select: { slug: true, title: true },
      })
    : null;

  const nomeDoItem =
    tentativa.kind === "PURCHASE"
      ? (novela?.title ?? "A novela")
      : planoPorCodigo(tentativa.plan ?? "MONTHLY").nome;

  // Destino só de caminho interno: aceitar URL absoluta aqui permitiria que
  // um link montado por terceiros levasse a pessoa para fora depois de pagar.
  const voltarPara =
    destino && destino.startsWith("/") && !destino.startsWith("//")
      ? destino
      : novela
        ? `/novela/${novela.slug}`
        : "/plantao";

  return (
    <EstadoDoPagamento
      inicial={{
        id: tentativa.id,
        status: tentativa.status,
        tipo: tentativa.kind,
        valorCents: tentativa.amountCents,
        metodo: tentativa.method,
        checkoutUrl: tentativa.checkoutUrl,
        pixQrCode: tentativa.pixQrCode,
        expiraEm: tentativa.expiresAt?.toISOString() ?? null,
        mensagem: tentativa.failureMessage,
        motivoCru: tentativa.rawStatus,
      }}
      destino={voltarPara}
      nomeDoItem={nomeDoItem}
    />
  );
}
