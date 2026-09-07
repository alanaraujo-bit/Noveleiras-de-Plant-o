import "server-only";

import { db } from "@/lib/db";
import type { EventType, Prisma } from "@prisma/client";

/**
 * Sink único de telemetria.
 *
 * Toda visão do painel da Fase 02 — retenção, abandono, buscas, engajamento,
 * novelas mais acessadas, tempo dentro da plataforma — deriva deste log
 * append-only somado às tabelas de progresso. Nenhuma tela do app escreve
 * métrica agregada: registra o fato, o agregado é derivado depois.
 */

export type TrackInput = {
  type: EventType;
  userId?: string | null;
  sessionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  novelaId?: string | null;
  episodeId?: string | null;
  valueMs?: number | null;
  path?: string | null;
  platform?: string | null;
  deviceId?: string | null;
  payload?: Prisma.InputJsonValue;
};

/**
 * Nunca lança: telemetria quebrada não pode derrubar uma tela. Falhas ficam
 * no log do servidor para investigação.
 */
export async function track(input: TrackInput): Promise<void> {
  try {
    await db.event.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        sessionId: input.sessionId || null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        novelaId: input.novelaId ?? null,
        episodeId: input.episodeId ?? null,
        valueMs: input.valueMs ?? null,
        path: input.path ?? null,
        platform: input.platform ?? "web",
        deviceId: input.deviceId ?? null,
        payload: input.payload ?? {},
      },
    });
  } catch (error) {
    console.error("[telemetria] falha ao registrar evento", input.type, error);
  }
}

/** Vários fatos de uma vez (usado pelo lote enviado pelo cliente). */
export async function trackMany(events: TrackInput[]): Promise<number> {
  if (events.length === 0) return 0;
  try {
    const result = await db.event.createMany({
      data: events.map((input) => ({
        type: input.type,
        userId: input.userId ?? null,
        sessionId: input.sessionId || null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        novelaId: input.novelaId ?? null,
        episodeId: input.episodeId ?? null,
        valueMs: input.valueMs ?? null,
        path: input.path ?? null,
        platform: input.platform ?? "web",
        deviceId: input.deviceId ?? null,
        payload: input.payload ?? {},
      })),
      skipDuplicates: false,
    });
    return result.count;
  } catch (error) {
    console.error("[telemetria] falha ao registrar lote", error);
    return 0;
  }
}

/**
 * Eventos que o cliente pode enviar. O resto só o servidor emite.
 *
 * Sessão não está aqui de propósito: começo, batimento e fim passam pela rota
 * /api/telemetria/sessao, que atualiza a própria AppSession — medir duração por
 * evento avulso perderia o tempo de quem fecha o app sem avisar.
 */
export const CLIENT_EVENT_TYPES = [
  "SCREEN_VIEW",
  "NOVELA_VIEW",
  "EPISODE_VIEW",
  "PLAY_START",
  "PLAY_PROGRESS",
  "PLAY_PAUSE",
  "PLAY_SEEK",
  "PLAY_COMPLETE",
  "PLAY_ABANDON",
  "PLAY_ERROR",
  "SEARCH_RESULT_CLICK",
  "CATEGORY_OPEN",
  "FEED_VIEW",
  "PAYWALL_VIEW",
  "PAYWALL_CTA",
  "PWA_INSTALLED",
  "CLIENT_ERROR",
] as const satisfies readonly EventType[];

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export function isClientEventType(value: unknown): value is ClientEventType {
  return (
    typeof value === "string" &&
    (CLIENT_EVENT_TYPES as readonly string[]).includes(value)
  );
}
