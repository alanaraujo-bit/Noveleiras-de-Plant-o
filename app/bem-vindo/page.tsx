import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { ROTA_INICIAL } from "@/lib/auth/destino";
import { Apresentacao } from "./Apresentacao";
import { ConcluirBoasVindas } from "./ConcluirBoasVindas";

export const metadata = { title: "Bem-vinda ao plantão" };

export default async function BemVindoPage() {
  const viewer = await getViewer();
  if (viewer?.onboardedAt) redirect(ROTA_INICIAL);

  // Mesma rota, dois momentos: quem não tem conta conhece o produto;
  // quem acabou de criar entra direto no Plantão.
  if (viewer) {
    return <ConcluirBoasVindas nome={viewer.name} />;
  }

  return <Apresentacao />;
}
