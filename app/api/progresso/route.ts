import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewer } from "@/lib/auth/session";
import { saveProgress } from "@/lib/repositories/progresso";
import { track } from "@/lib/analytics/track";
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

  // Tempo assistido como fato datado.
  //
  // `WatchProgress.watchedMs` é cumulativo: responde "quanto esta pessoa já
  // assistiu deste episódio", mas não "quanto foi assistido na terça". Sem o
  // evento abaixo, qualquer gráfico de tempo assistido por período seria
  // estimativa. Emitido no servidor, onde `deltaMs` já passou pela validação —
  // o cliente não escolhe quanto tempo diz ter assistido.
  //
  // Volume: um evento a cada 10s de reprodução ativa. Se um dia isso pesar, o
  // caminho é somar em tabela de rollup diária lendo daqui; nenhuma tela muda,
  // porque todas leem `lib/painel/metricas`.
  if (input.deltaMs > 0 && saved) {
    const episodio = await db.episode.findUnique({
      where: { id: input.episodeId },
      select: { novelaId: true },
    });
    await track({
      type: "PLAY_PROGRESS",
      userId: viewer.id,
      sessionId: sessionId || viewer.appSessionId,
      episodeId: input.episodeId,
      novelaId: episodio?.novelaId ?? null,
      valueMs: input.deltaMs,
      payload: {
        positionSec: Math.round(input.positionSec),
        percent: saved.percent,
      },
    });
  }

  return NextResponse.json({ ok: true, progresso: saved });
}
