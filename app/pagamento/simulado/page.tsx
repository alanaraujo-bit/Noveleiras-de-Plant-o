import { notFound, redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { podeUsarMock } from "@/lib/pagamentos";
import { CheckoutSimulado } from "./CheckoutSimulado";

export const metadata = { title: "Checkout de teste" };
export const dynamic = "force-dynamic";

/**
 * Checkout falso, no lugar da página hospedada do provedor.
 *
 * Só existe fora de produção: `podeUsarMock()` exige `PAGAMENTOS_MOCK` ligado
 * *e* ambiente não-produtivo, e sem isso a rota é `notFound()` — nem confirma
 * que o endereço existe. É por aqui que se exercita à mão o que o script de
 * prova exercita por HTTP: aprovar, recusar, reembolsar, estornar.
 */
export default async function CheckoutSimuladoPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  if (!podeUsarMock()) notFound();

  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const { ref } = await searchParams;
  if (!ref) notFound();

  const tentativa = await db.paymentAttempt.findFirst({
    where: { externalId: ref },
    select: {
      id: true,
      userId: true,
      kind: true,
      amountCents: true,
      status: true,
      externalId: true,
      novelaId: true,
    },
  });

  // Mesmo no modo de teste a posse é conferida: um atalho aqui vira hábito, e
  // hábito vira o mesmo atalho na rota de verdade.
  if (!tentativa || tentativa.userId !== viewer.id) notFound();

  const novela = tentativa.novelaId
    ? await db.novela.findUnique({
        where: { id: tentativa.novelaId },
        select: { slug: true, title: true },
      })
    : null;

  return (
    <CheckoutSimulado
      attemptId={tentativa.id}
      externalId={tentativa.externalId ?? ""}
      valorCents={tentativa.amountCents}
      tipo={tentativa.kind}
      status={tentativa.status}
      nomeDoItem={novela?.title ?? "Assinatura do Plantão"}
    />
  );
}
