import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import { FormCriarConta } from "./FormCriarConta";

export const metadata = { title: "Criar conta" };

export default async function CriarContaPage({ searchParams }: { searchParams: Promise<{ destino?: string }> }) {
  const viewer = await getViewer();
  const destino = destinoSeguro((await searchParams).destino) ?? ROTA_INICIAL;
  if (viewer) redirect(destino);
  return (
    <FormCriarConta
      destino={destino}
      googleDisponivel={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
    />
  );
}
