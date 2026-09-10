import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { ROTA_INICIAL } from "@/lib/auth/destino";
import { FormCriarConta } from "./FormCriarConta";

export const metadata = { title: "Criar conta" };

export default async function CriarContaPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.onboardedAt ? ROTA_INICIAL : "/bem-vindo");
  return <FormCriarConta />;
}
