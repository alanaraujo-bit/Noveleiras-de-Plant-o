import { NextResponse } from "next/server";

import {
  cronAutorizado,
  executarCronDeAssinaturas,
} from "@/lib/pagamentos/cron";

/**
 * Cron diário de assinaturas: reconcilia com o Mercado Pago e só então fecha
 * ciclos vencidos.
 *
 * A reconciliação daqui é a **diária**: só as assinaturas perto de virar o
 * ciclo, em tolerância ou com cobrança falha — o suficiente para renovar antes
 * de a expiração cortar alguém que pagou. A varredura larga, que olha todas e
 * pega cancelamento feito direto no painel do Mercado Pago, é a rota irmã
 * `/api/cron/assinaturas/varredura`, semanal.
 *
 * **Não é porta de segurança.** A leitura de direitos já ignora qualquer linha
 * vencida, então o acesso está correto mesmo que este cron nunca rode — de
 * propósito, para que uma falha no agendador não vire catálogo liberado.
 */
export const dynamic = "force-dynamic";

export async function GET(requisicao: Request) {
  if (!cronAutorizado(requisicao)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  return NextResponse.json(await executarCronDeAssinaturas({ completa: false }));
}
