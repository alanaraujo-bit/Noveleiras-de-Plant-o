import { NextResponse } from "next/server";

import { expirarDireitosVencidos } from "@/lib/access/direitos";
import { log } from "@/lib/painel/log";
import { expirarAssinaturasVencidas } from "@/lib/pagamentos/servico";

/**
 * Fecha ciclos vencidos.
 *
 * **Não é porta de segurança.** A leitura de direitos já ignora qualquer
 * linha cuja `endsAt` passou, então o acesso está correto mesmo que este cron
 * nunca rode — foi assim de propósito, para que uma falha no agendador não
 * vire catálogo liberado de graça.
 *
 * O que ele faz é higiene de dado: sem isso, o painel continuaria contando
 * como assinante quem deixou de ser um, e o MRR mostraria receita que não
 * existe mais.
 *
 * Mesma autorização do cron de alertas: sem `CRON_SECRET` a rota se recusa a
 * rodar, em vez de ficar aberta para qualquer um disparar.
 */
export const dynamic = "force-dynamic";

function autorizado(requisicao: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  return requisicao.headers.get("authorization") === `Bearer ${segredo}`;
}

export async function GET(requisicao: Request) {
  if (!autorizado(requisicao)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  // Ordem importa: primeiro as assinaturas, que revogam os direitos ligados a
  // elas; depois a varredura solta, que pega direitos órfãos de compra ou
  // concessão manual.
  const assinaturas = await expirarAssinaturasVencidas();
  const direitos = await expirarDireitosVencidos();

  if (assinaturas > 0 || direitos > 0) {
    void log.info({
      channel: "JOBS",
      message: `Ciclos encerrados: ${assinaturas} assinatura(s), ${direitos} direito(s)`,
      context: { assinaturas, direitos },
    });
  }

  return NextResponse.json({ assinaturas, direitos });
}
