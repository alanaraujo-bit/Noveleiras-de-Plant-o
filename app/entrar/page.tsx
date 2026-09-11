import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import { db } from "@/lib/db";
import { posterUrl } from "@/lib/media/resolver";
import { FormEntrar } from "./FormEntrar";

export const metadata = { title: "Entrar" };

export default async function EntrarPage({
  searchParams,
}: {
    searchParams: Promise<{ destino?: string; google?: string }>;
}) {
  const viewer = await getViewer();
  const { destino, google } = await searchParams;
  const destinoValido = destinoSeguro(destino) ?? undefined;
  if (viewer) redirect(destinoValido ?? ROTA_INICIAL);

  const episodioId = destinoValido
    ? new URL(destinoValido, "http://local").searchParams.get("episodio")
    : null;
  const episodio = episodioId
    ? await db.episode.findUnique({
        where: { id: episodioId },
        select: {
          title: true,
          novela: { select: { title: true, heroKey: true } },
        },
      })
    : null;

  return (
    <FormEntrar
      destino={destinoValido}
      googleErro={google}
      googleDisponivel={Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )}
      destaque={
        episodio
          ? {
              imagemUrl: posterUrl(episodio.novela.heroKey),
              etiqueta: `Você estava assistindo ${episodio.novela.title}`,
              titulo: episodio.title,
            }
          : undefined
      }
    />
  );
}
