import { NextResponse } from "next/server";
import { z } from "zod";

import { podeUsarMock, provedorDePagamento } from "@/lib/pagamentos";
import { reconciliarPagamento } from "@/lib/pagamentos/servico";

/**
 * Controle remoto do provedor falso.
 *
 * Existe para que os cenários que dependem de um evento do adquirente —
 * reembolso, chargeback, aprovação de um Pix pendente — sejam exercitáveis
 * antes de qualquer credencial existir. É o que torna `provar-pagamentos.mjs`
 * capaz de cobrir a definição de pronto inteira.
 *
 * **A rota inteira só existe fora de produção.** `podeUsarMock()` já exige
 * `PAGAMENTOS_MOCK` ligado *e* ambiente não-produtivo; aqui a mesma condição
 * é conferida antes de qualquer efeito. Com o provedor real ativo, todo
 * pedido responde 404 — nem confirma que o endereço existe.
 *
 * Não tem autenticação de sessão de propósito: em produção ela não responde
 * nada, e em desenvolvimento exigir login só atrapalharia o script de prova.
 * A trava é o ambiente, não um cabeçalho que alguém possa forjar.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  acao: z.enum(["reconciliar", "reembolsar", "aprovar", "recusar", "estornar"]),
  externalId: z.string().min(1).max(128),
  valorCents: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  if (!podeUsarMock()) {
    return NextResponse.json({ erro: "não encontrado" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }

  const { acao, externalId, valorCents } = parsed.data;
  const provedor = provedorDePagamento();

  // Import tardio: a classe do mock não deve nem ser carregada quando o
  // provedor real está ativo.
  const { ProvedorMock } = await import("@/lib/pagamentos/mock");

  switch (acao) {
    case "aprovar":
      ProvedorMock.definirStatus(externalId, "APPROVED");
      break;
    case "recusar":
      ProvedorMock.definirStatus(externalId, "REJECTED");
      break;
    case "estornar":
      ProvedorMock.definirStatus(externalId, "CHARGEBACK");
      break;
    case "reembolsar":
      await provedor.reembolsar(externalId, valorCents);
      break;
    case "reconciliar":
      break;
  }

  const resultado = await reconciliarPagamento(externalId);

  return NextResponse.json(
    { ok: true, acao, resultado },
    { headers: { "Cache-Control": "no-store" } },
  );
}
