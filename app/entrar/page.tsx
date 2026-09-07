import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { FormEntrar } from "./FormEntrar";

export const metadata = { title: "Entrar" };

export default async function EntrarPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.onboardedAt ? "/inicio" : "/bem-vindo");
  return <FormEntrar />;
}
