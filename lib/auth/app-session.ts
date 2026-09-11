import "server-only";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { lerDispositivo } from "@/lib/analytics/dispositivo";

/** Abre a sessão observável usada por qualquer método de autenticação. */
export async function abrirSessaoDoApp(userId: string) {
  const headerList = await headers();
  const userAgent = headerList.get("user-agent") ?? undefined;
  const dispositivo = lerDispositivo(userAgent);
  const session = await db.appSession.create({
    data: {
      userId,
      deviceId: "pendente",
      osName: dispositivo.osName,
      browser: dispositivo.browser,
      platform: dispositivo.platform,
      userAgent: userAgent?.slice(0, 400),
      referrer: headerList.get("referer")?.slice(0, 300) ?? null,
    },
    select: { id: true },
  });
  return session.id;
}
