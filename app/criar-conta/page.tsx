import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { FormCriarConta } from "./FormCriarConta";

export const metadata = { title: "Criar conta" };

export default async function CriarContaPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.onboardedAt ? "/inicio" : "/bem-vindo");
  return <FormCriarConta />;
}
