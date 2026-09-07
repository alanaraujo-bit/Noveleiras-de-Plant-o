import { NextResponse } from "next/server";

import { reconciliarAlertas } from "@/lib/painel/alertas";
import { log } from "@/lib/painel/log";

/**
 * Avaliação periódica dos alertas.
 *
 * Chamada pelo agendador da Vercel (`vercel.json`) e, opcionalmente, à mão com
 * o mesmo segredo. A Vercel assina as próprias chamadas com `CRON_SECRET`; sem
 * a variável configurada, a rota se recusa a rodar em vez de ficar aberta —
 * um endpoint que qualquer um dispara é um vetor de carga, mesmo sendo só
 * leitura.
 *
 * A avaliação também roda a cada batimento do agente, que é o que dá reação
 * rápida. Este cron existe para o caso que o batimento não cobre: quando o
 * agente **parou**, e portanto ninguém vai chamar nada.
 */

export const dynamic = "force-dynamic";

function autorizado(requisicao: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  const cabecalho = requisicao.headers.get("authorization");
  return cabecalho === `Bearer ${segredo}`;
}

export async function GET(requisicao: Request) {
  if (!autorizado(requisicao)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const resultado = await reconciliarAlertas();

  if (resultado.erros.length > 0) {
    void log.error({
      channel: "JOBS",
      message: "Regras de alerta falharam durante a avaliação",
      context: { erros: resultado.erros },
    });
  }
  if (resultado.abertos > 0 || resultado.resolvidos > 0) {
    void log.info({
      channel: "JOBS",
      message: `Alertas: ${resultado.abertos} aberto(s), ${resultado.resolvidos} resolvido(s)`,
      context: { ...resultado },
    });
  }

  return NextResponse.json(resultado);
}
