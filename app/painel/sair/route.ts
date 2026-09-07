import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { clearSessionCookie, getViewer } from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";

/**
 * Sair pelo painel.
 *
 * É POST de propósito: um link GET de logout é acionado por qualquer coisa que
 * pré-carregue a página — inclusive o próprio navegador — e derrubaria a
 * sessão de quem só passou o mouse por cima.
 */
export async function POST() {
  const viewer = await getViewer();
  if (viewer) {
    await track({
      type: "SIGN_OUT",
      userId: viewer.id,
      sessionId: viewer.appSessionId,
    });
    if (viewer.appSessionId) {
      await db.appSession
        .update({
          where: { id: viewer.appSessionId },
          data: { endedAt: new Date() },
        })
        .catch(() => {});
    }
  }
  await clearSessionCookie();
  redirect("/entrar");
}
