import { NextResponse } from "next/server";

import {
  cronAutorizado,
  executarCronDeAssinaturas,
} from "@/lib/pagamentos/cron";

/**
 * Varredura semanal de assinaturas: reconcilia TODAS as que têm preapproval,
 * não só as perto de vencer, e depois fecha ciclos vencidos.
 *
 * É a que descobre o que a diária não procura: cancelamento feito direto no
 * painel do Mercado Pago, divergência entre o que o provedor cobrou e os
 * ciclos do nosso livro. Rota própria — e não um parâmetro da diária — porque
 * cron da Vercel é um caminho declarado no `vercel.json`: é assim que ela pode
 * ser agendada e disparada com `vercel crons run`, sempre com `CRON_SECRET`.
 */
export const dynamic = "force-dynamic";

export async function GET(requisicao: Request) {
  if (!cronAutorizado(requisicao)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  return NextResponse.json(await executarCronDeAssinaturas({ completa: true }));
}
