import { NextResponse } from "next/server";

import { searchCatalog, recordSearch } from "@/lib/repositories/busca";
import { getViewer } from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";

/**
 * Busca ao vivo. O termo só é registrado quando o usuário para de digitar
 * (`registrar=1`), para que a métrica reflita intenção e não cada tecla.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const termo = (searchParams.get("q") ?? "").slice(0, 80);
  const registrar = searchParams.get("registrar") === "1";

  const resultado = await searchCatalog(termo);

  if (registrar && termo.trim().length >= 2) {
    const viewer = await getViewer();
    await recordSearch({
      term: termo,
      userId: viewer?.id ?? null,
      sessionId: viewer?.appSessionId ?? null,
      resultCount: resultado.novelas.length,
    });
    await track({
      type: "SEARCH",
      userId: viewer?.id ?? null,
      sessionId: viewer?.appSessionId ?? null,
      payload: { termo, resultados: resultado.novelas.length },
    });
  }

  return NextResponse.json(resultado);
}
