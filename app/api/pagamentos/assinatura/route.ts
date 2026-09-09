import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";
import {
  cancelarAssinaturaDoUsuario,
  ErroDeCobranca,
  historicoDoUsuario,
} from "@/lib/pagamentos/servico";

/**
 * Gerenciamento da própria assinatura.
 *
 * `DELETE` cancela; `GET` devolve o histórico de compras. Ambos operam sempre
 * sobre a sessão — não existe parâmetro de usuário, então não existe o que
 * manipular no navegador para agir na conta de outra pessoa.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  const { pagamentos, compras, reembolsos } = await historicoDoUsuario(
    viewer.id,
  );

  return NextResponse.json(
    {
      pagamentos: pagamentos.map((p) => ({
        id: p.id,
        data: p.createdAt.toISOString(),
        valorCents: p.amountCents,
        status: p.status,
        metodo: p.method,
        plano: p.plan,
        reembolsadoCents: p.refundedCents,
      })),
      compras: compras.map((c) => ({
        id: c.id,
        data: c.createdAt.toISOString(),
        valorCents: c.amountCents,
        status: c.status,
        novela: { slug: c.novela.slug, titulo: c.novela.title },
      })),
      reembolsos: reembolsos.map((r) => ({
        id: r.id,
        data: r.createdAt.toISOString(),
        valorCents: r.amountCents,
        tipo: r.kind,
        status: r.status,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function DELETE() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  try {
    const { ativoAte } = await cancelarAssinaturaDoUsuario(viewer.id);

    await track({
      type: "SUBSCRIPTION_CANCEL",
      userId: viewer.id,
      sessionId: viewer.appSessionId,
      payload: { ativoAte: ativoAte?.toISOString() ?? null },
    });

    return NextResponse.json(
      {
        ok: true,
        // O acesso continua até o fim do ciclo pago. A tela mostra esta data
        // em vez de dizer "cancelado" e sumir com o conteúdo.
        ativoAte: ativoAte?.toISOString() ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    if (erro instanceof ErroDeCobranca) {
      return NextResponse.json({ erro: erro.message }, { status: 400 });
    }
    console.error("[assinatura] cancelamento falhou", erro);
    return NextResponse.json(
      { erro: "Não foi possível cancelar agora." },
      { status: 502 },
    );
  }
}
