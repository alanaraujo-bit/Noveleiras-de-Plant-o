import "server-only";

import { db } from "@/lib/db";
import type { LogChannel, LogLevel, Prisma } from "@prisma/client";

/**
 * Central de logs da aplicação.
 *
 * `Event` guarda o que a **pessoa** fez; aqui fica o que o **sistema** fez —
 * uma falha de pagamento, uma mídia que não abriu, um job que morreu. Manter
 * os dois separados é o que permite investigar um incidente sem peneirar meio
 * milhão de `SCREEN_VIEW`.
 *
 * `correlationId` é o que costura uma investigação: a mesma reprodução que
 * falhou aparece no canal STREAMING, no MEDIA e no SERVER com a mesma chave, e
 * a tela de logs consegue montar a história inteira.
 */

export type EntradaDeLog = {
  level?: LogLevel;
  channel: LogChannel;
  message: string;
  correlationId?: string | null;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  path?: string | null;
  erro?: unknown;
  context?: Prisma.InputJsonValue;
};

function pilha(erro: unknown): string | null {
  if (!erro) return null;
  if (erro instanceof Error) return (erro.stack ?? erro.message).slice(0, 4000);
  return String(erro).slice(0, 4000);
}

/** Nunca lança: registrar uma falha não pode virar uma segunda falha. */
export async function registrarLog(entrada: EntradaDeLog): Promise<void> {
  try {
    await db.appLog.create({
      data: {
        level: entrada.level ?? "INFO",
        channel: entrada.channel,
        message: entrada.message.slice(0, 1000),
        correlationId: entrada.correlationId ?? null,
        userId: entrada.userId ?? null,
        entityType: entrada.entityType ?? null,
        entityId: entrada.entityId ?? null,
        path: entrada.path ?? null,
        stack: pilha(entrada.erro),
        context: entrada.context ?? {},
      },
    });
  } catch (falha) {
    console.error("[log] falha ao registrar", entrada.message, falha);
  }
}

export const log = {
  debug: (e: Omit<EntradaDeLog, "level">) => registrarLog({ ...e, level: "DEBUG" }),
  info: (e: Omit<EntradaDeLog, "level">) => registrarLog({ ...e, level: "INFO" }),
  warn: (e: Omit<EntradaDeLog, "level">) => registrarLog({ ...e, level: "WARN" }),
  error: (e: Omit<EntradaDeLog, "level">) => registrarLog({ ...e, level: "ERROR" }),
  fatal: (e: Omit<EntradaDeLog, "level">) => registrarLog({ ...e, level: "FATAL" }),
};

/** Identificador curto para costurar linhas de uma mesma investigação. */
export function novaCorrelacao(prefixo = "req"): string {
  return `${prefixo}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
