import { notFound, redirect } from "next/navigation";

import { EstadoDoPagamento } from "@/components/pagamento/EstadoDoPagamento";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { planoPorCodigo } from "@/lib/pagamentos/planos";
import { reconciliarPagamento } from "@/lib/pagamentos/servico";

export const metadata = { title: "Pagamento" };
export const dynamic = "force-dynamic";

/** Um lugar só: a tentativa é relida depois da reconciliação. */
const SELECAO = {
  id: true,
  userId: true,
  status: true,
  kind: true,
  plan: true,
  billingMode: true,
  amountCents: true,
  method: true,
  checkoutUrl: true,
  pixQrCode: true,
  pixQrCodeBase64: true,
  expiresAt: true,
  failureMessage: true,
  rawStatus: true,
  externalId: true,
  novelaId: true,
} as const;

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

  let tentativa = await db.paymentAttempt.findUnique({
    where: { id: attemptId },
    select: SELECAO,
  });

  if (!tentativa || tentativa.userId !== viewer.id) notFound();

  // Cobrança Pix sem desfecho: reconsulta antes de pintar qualquer coisa.
  //
  // O caso que obriga isto é o Pix pago na virada do prazo: a nossa linha já
  // está EXPIRED e a aprovação existe do lado deles. Sem a releitura, quem
  // acabou de pagar abre o aplicativo e lê "esse Pix expirou", com um botão
  // oferecendo gerar outro — ou seja, pagar duas vezes. A varredura do cron
  // conserta, mas só de madrugada, e é agora que ela está olhando.
  //
  // A tela do cliente não resolve isto sozinha: ela para de consultar em
  // qualquer estado final, e quem fechou o aplicativo volta por uma pintura
  // nova, não por um `setTimeout`.
  if (
    tentativa.kind === "SUBSCRIPTION" &&
    tentativa.billingMode === "MANUAL_RENEW" &&
    tentativa.externalId &&
    ["CREATED", "PENDING", "EXPIRED"].includes(tentativa.status)
  ) {
    try {
      await reconciliarPagamento(tentativa.externalId);
      tentativa = (await db.paymentAttempt.findUnique({
        where: { id: attemptId },
        select: SELECAO,
      }))!;
    } catch (erro) {
      // Provedor fora do ar não pode derrubar a tela: o webhook ainda chega,
      // a consulta periódica da tela tenta de novo e o cron fecha a conta.
      console.error("[pagamento] reconciliação falhou", erro);
    }
  }

  // Quando a cobrança já está aprovada na primeira pintura — quem volta depois
  // de pagar —, a tela não consulta mais nada: ela para de perguntar em
  // qualquer estado final. Sem buscar a data aqui, essa pessoa leria a frase
  // genérica em vez de "liberado até 11 de outubro", que é a única coisa que
  // ela abriu o aplicativo para saber.
  const aprovadaDeAssinatura =
    tentativa.status === "APPROVED" && tentativa.kind === "SUBSCRIPTION";

  const [assinaturaAtual, cobrancaDoCiclo] = aprovadaDeAssinatura
    ? await Promise.all([
        db.subscription.findUnique({
          where: { userId: viewer.id },
          select: { currentPeriodEnd: true },
        }),
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
        renovacao: tentativa.billingMode,
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
      }}
      destino={voltarPara}
      nomeDoItem={nomeDoItem}
    />
  );
}
