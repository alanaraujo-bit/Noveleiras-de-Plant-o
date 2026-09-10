import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import { FormEntrar } from "./FormEntrar";

export const metadata = { title: "Entrar" };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ destino?: string }>;
}) {
  const viewer = await getViewer();
  const { destino } = await searchParams;
  if (viewer) redirect(destinoSeguro(destino) ?? (viewer.onboardedAt ? ROTA_INICIAL : "/bem-vindo"));
  return <FormEntrar destino={destinoSeguro(destino) ?? undefined} />;
}
