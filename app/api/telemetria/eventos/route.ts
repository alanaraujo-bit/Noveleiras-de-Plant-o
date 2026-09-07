import { NextResponse } from "next/server";
import { z } from "zod";

import { getViewer } from "@/lib/auth/session";
import { isClientEventType, trackMany } from "@/lib/analytics/track";

/** Recebe o lote de eventos do cliente. Só aceita os tipos permitidos. */

const eventSchema = z.object({
  type: z.string(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(200).optional(),
  novelaId: z.string().max(40).optional(),
  episodeId: z.string().max(40).optional(),
  valueMs: z.number().int().min(0).max(6 * 3_600_000).optional(),
  path: z.string().max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const batchSchema = z.object({
  sessionId: z.string().nullish(),
  deviceId: z.string().max(80).nullish(),
  events: z.array(eventSchema).max(60),
});

export async function POST(request: Request) {
  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Lote inválido" }, { status: 400 });
  }

  const viewer = await getViewer();
  const { sessionId, deviceId, events } = parsed.data;

  const accepted = events.filter((event) => isClientEventType(event.type));
  const saved = await trackMany(
    accepted.map((event) => ({
      type: event.type as Parameters<typeof trackMany>[0][number]["type"],
      userId: viewer?.id ?? null,
      sessionId: sessionId ?? viewer?.appSessionId ?? null,
      deviceId: deviceId ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      novelaId: event.novelaId ?? null,
      episodeId: event.episodeId ?? null,
      valueMs: event.valueMs ?? null,
      path: event.path ?? null,
      payload: (event.payload ?? {}) as Record<string, never>,
    })),
  );

  return NextResponse.json({ recebidos: saved });
}
