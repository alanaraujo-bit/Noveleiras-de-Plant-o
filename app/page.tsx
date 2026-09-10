import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { ROTA_INICIAL } from "@/lib/auth/destino";

export default async function RaizPage() {
  const viewer = await getViewer();
  if (viewer?.onboardedAt) redirect(ROTA_INICIAL);
  redirect("/bem-vindo");
}
