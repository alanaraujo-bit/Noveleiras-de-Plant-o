import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";

/**
 * Sessões de aplicativo.
 *
 * POST abre (ou reaproveita) a sessão e registra o dispositivo.
 * PATCH recebe os batimentos de tempo ativo — é daqui que sai "tempo dentro da
 * plataforma" no painel futuro.
 */

const openSchema = z.object({
  sessionId: z.string().nullish(),
  deviceId: z.string().min(4).max(80),
  platform: z.string().max(20).default("web"),
  osName: z.string().max(40).nullish(),
  browser: z.string().max(40).nullish(),
  screenW: z.number().int().positive().max(20000).nullish(),
  screenH: z.number().int().positive().max(20000).nullish(),
  standalone: z.boolean().default(false),
  userAgent: z.string().max(400).nullish(),
  language: z.string().max(20).nullish(),
  timezone: z.string().max(60).nullish(),
  referrer: z.string().max(300).nullish(),
});

export async function POST(request: Request) {
  const parsed = openSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { sessionId, ...device } = parsed.data;
  const viewer = await getViewer();

  const candidateId = sessionId || viewer?.appSessionId || null;
  if (candidateId) {
    const existing = await db.appSession.findUnique({
      where: { id: candidateId },
      select: { id: true, endedAt: true },
    });
    if (existing && !existing.endedAt) {
      await db.appSession.update({
        where: { id: existing.id },
        data: { ...device, userId: viewer?.id ?? undefined, lastBeatAt: new Date() },
      });
      return NextResponse.json({ sessionId: existing.id });
    }
  }

  const created = await db.appSession.create({
    data: { ...device, userId: viewer?.id ?? null },
    select: { id: true },
  });

  await track({
    type: "SESSION_START",
    userId: viewer?.id ?? null,
    sessionId: created.id,
    deviceId: device.deviceId,
    platform: device.platform,
    payload: { osName: device.osName, browser: device.browser },
  });

  return NextResponse.json({ sessionId: created.id });
}

const beatSchema = z.object({
  sessionId: z.string().min(1),
  activeMs: z.number().int().min(0).max(10 * 60_000),
  screenViews: z.number().int().min(0).max(500).default(0),
});

export async function PATCH(request: Request) {
  const parsed = beatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { sessionId, activeMs, screenViews } = parsed.data;
  const viewer = await getViewer();

  try {
    await db.appSession.update({
      where: { id: sessionId },
      data: {
        durationMs: { increment: activeMs },
        screenViews: { increment: screenViews },
        lastBeatAt: new Date(),
        userId: viewer?.id ?? undefined,
      },
    });
    if (viewer) {
      await db.user.update({
        where: { id: viewer.id },
        data: { lastSeenAt: new Date() },
      });
    }
  } catch {
    // Sessão pode ter sido removida; o cliente abre outra no próximo POST.
    return NextResponse.json({ ok: false }, { status: 204 });
  }

  return NextResponse.json({ ok: true });
}
