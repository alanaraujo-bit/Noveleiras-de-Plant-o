import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewer } from "@/lib/auth/session";
import { saveProgress } from "@/lib/repositories/progresso";
import { db } from "@/lib/db";

/** Recebe o progresso do player. Chamado periodicamente e ao sair da tela. */

const schema = z.object({
  episodeId: z.string().min(1),
  positionSec: z.number().min(0).max(24 * 3600),
  durationSec: z.number().min(1).max(24 * 3600),
  deltaMs: z.number().int().min(0).max(5 * 60_000).default(0),
  completed: z.boolean().optional(),
  abandoned: z.boolean().optional(),
  sessionId: z.string().nullish(),
});

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ erro: "Sem sessão." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  }

  const { sessionId, ...input } = parsed.data;
  const saved = await saveProgress({ userId: viewer.id, ...input });

  // Tempo assistido também fica na sessão: alimenta o painel por dispositivo.
  if (input.deltaMs > 0 && (sessionId || viewer.appSessionId)) {
    await db.appSession
      .update({
        where: { id: sessionId || viewer.appSessionId },
        data: { watchedMs: { increment: input.deltaMs } },
      })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, progresso: saved });
}
