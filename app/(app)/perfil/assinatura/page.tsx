import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { planLabel } from "@/lib/access/entitlements";
import { PainelAssinatura } from "./PainelAssinatura";
import { IconeVoltar } from "@/components/ui/icones";

export const metadata = { title: "Assinatura" };

export default async function AssinaturaPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  return (
    <div>
      <header
        className="flex items-center gap-2 px-4 pb-4"
        style={{ paddingTop: "calc(var(--safe-t) + 1rem)" }}
      >
        <Link
          href="/perfil"
          aria-label="Voltar para o perfil"
          className="tap grid size-10 place-items-center rounded-full text-cream-200 hover:bg-white/8"
        >
          <IconeVoltar tamanho={20} />
        </Link>
        <div>
          <p className="eyebrow">{planLabel(viewer.entitlement.plan)}</p>
          <h1 className="text-[1.5rem] leading-tight">Assinatura</h1>
        </div>
      </header>

      <PainelAssinatura
        plano={viewer.entitlement.plan}
        premium={viewer.entitlement.premium}
        episodiosGratis={viewer.entitlement.freePreviewEpisodes}
        renovaEm={
          viewer.entitlement.currentPeriodEnd
            ? viewer.entitlement.currentPeriodEnd.toISOString()
            : null
        }
      />
    </div>
  );
}
