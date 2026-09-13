import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import { limparNome } from "@/lib/auth/identidade";
import { Apresentacao } from "./Apresentacao";
import { ConcluirBoasVindas } from "./ConcluirBoasVindas";

export const metadata = { title: "Bem-vinda ao plantão" };

export default async function BemVindoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const destino = destinoSeguro((await searchParams).destino);
  if (viewer?.onboardedAt) redirect(destino ?? ROTA_INICIAL);

  // Mesma rota, dois momentos: quem não tem conta conhece o produto; quem
  // acabou de entrar pelo Google escolhe como vai aparecer.
  if (viewer) {
    return (
      <ConcluirBoasVindas
        nome={limparNome(viewer.name)}
        handle={viewer.handle}
        avatarSeed={viewer.avatarSeed}
        avatarUrl={viewer.avatarUrl}
        destino={destino}
      />
    );
  }

  return <Apresentacao />;
}
