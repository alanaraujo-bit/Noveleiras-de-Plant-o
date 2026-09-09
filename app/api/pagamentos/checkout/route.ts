import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewer } from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";
import { ProvedorNaoConfigurado } from "@/lib/pagamentos";
import {
  ErroDeCobranca,
  iniciarAssinatura,
  iniciarCompra,
} from "@/lib/pagamentos/servico";
import { ehPlanoVendavel } from "@/lib/pagamentos/planos";

/**
 * Abre uma cobrança.
 *
 * O que **não** chega do cliente, e é o ponto inteiro deste desenho: preço,
 * plano-como-valor-livre, id de usuário e status. O corpo carrega apenas a
 * escolha (qual plano, qual novela, cartão ou Pix); tudo que tem consequência
 * financeira é resolvido no servidor, a partir da sessão e do catálogo.
 *
 * Trocar `valorCents` no navegador não faz nada porque `valorCents` não
 * existe aqui.
 */
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("assinatura"),
    // Só os códigos vendáveis. `FREE`, `PREMIUM` e `VIP` são recusados pelo
    // próprio schema, antes de qualquer consulta.
    plano: z.enum(["MONTHLY", "ANNUAL"]),
    metodo: z.enum(["CARD", "PIX"]).default("CARD"),
  }),
  z.object({
    tipo: z.literal("compra"),
    novelaId: z.string().min(1).max(64),
    metodo: z.enum(["CARD", "PIX"]).default("CARD"),
  }),
]);

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json(
      { erro: "Entre na sua conta para continuar." },
      { status: 401 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }

  const dados = parsed.data;
  const origem = new URL(request.url).origin;

  try {
    if (dados.tipo === "assinatura") {
      // Redundante com o schema de propósito: se um plano novo entrar no enum
      // e não for vendável, esta guarda o barra sem depender de alguém
      // lembrar de atualizar dois lugares.
      if (!ehPlanoVendavel(dados.plano)) {
        return NextResponse.json(
          { erro: "Plano indisponível." },
          { status: 400 },
        );
      }

      const resultado = await iniciarAssinatura({
        userId: viewer.id,
        plano: dados.plano,
        metodo: dados.metodo,
        urlRetorno: `${origem}/pagamento/retorno`,
      });

      await track({
        type: "CHECKOUT_START",
        userId: viewer.id,
        sessionId: viewer.appSessionId,
        payload: { tipo: "assinatura", plano: dados.plano },
      });

      return NextResponse.json(resultado, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const resultado = await iniciarCompra({
      userId: viewer.id,
      novelaId: dados.novelaId,
      metodo: dados.metodo,
      urlRetorno: `${origem}/pagamento/retorno`,
    });

    await track({
      type: "CHECKOUT_START",
      userId: viewer.id,
      sessionId: viewer.appSessionId,
      novelaId: dados.novelaId,
      payload: { tipo: "compra" },
    });

    return NextResponse.json(resultado, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erro) {
    if (erro instanceof ErroDeCobranca) {
      return NextResponse.json(
        { erro: erro.message, codigo: erro.codigo },
        { status: erro.codigo === "ja-possui" ? 409 : 400 },
      );
    }

    if (erro instanceof ProvedorNaoConfigurado) {
      // 503, não 500: o serviço existe e voltará quando as credenciais forem
      // preenchidas. A mensagem cita as variáveis para quem estiver operando.
      return NextResponse.json(
        {
          erro: "Pagamentos ainda não estão ativos.",
          detalhe: erro.faltando,
        },
        { status: 503 },
      );
    }

    console.error("[checkout] falha", erro);
    return NextResponse.json(
      { erro: "Não foi possível iniciar o pagamento." },
      { status: 502 },
    );
  }
}
