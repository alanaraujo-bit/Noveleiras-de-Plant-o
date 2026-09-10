import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { ROTA_INICIAL } from "@/lib/auth/destino";
import { listGenres } from "@/lib/repositories/catalog";
import { Apresentacao } from "./Apresentacao";
import { EscolhaDeGeneros } from "./EscolhaDeGeneros";

export const metadata = { title: "Bem-vinda ao plantão" };

export default async function BemVindoPage() {
  const viewer = await getViewer();
  if (viewer?.onboardedAt) redirect(ROTA_INICIAL);

  // Mesma rota, dois momentos: quem não tem conta conhece o produto;
  // quem acabou de criar escolhe por onde começar.
  if (viewer) {
    const generos = await listGenres();
    return <EscolhaDeGeneros nome={viewer.name} generos={generos} />;
  }

  return <Apresentacao />;
}
