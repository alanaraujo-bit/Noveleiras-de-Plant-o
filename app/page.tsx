import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";

export default async function RaizPage() {
  const viewer = await getViewer();
  if (viewer?.onboardedAt) redirect("/inicio");
  redirect("/bem-vindo");
}
