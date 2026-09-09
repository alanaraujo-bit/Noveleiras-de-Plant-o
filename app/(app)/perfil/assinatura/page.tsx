import Link from "next/link";
import { redirect } from "next/navigation";

import { IconeVoltar } from "@/components/ui/icones";
import { planLabel } from "@/lib/access/entitlements";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { historicoDoUsuario } from "@/lib/pagamentos/servico";
import { PainelAssinatura } from "./PainelAssinatura";

export const metadata = { title: "Assinatura" };
export const dynamic = "force-dynamic";

export default async function AssinaturaPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  // O histórico é carregado no servidor: são dados financeiros da pessoa, e
  // buscá-los no cliente exporia um endpoint a mais sem ganho nenhum.
  const [{ pagamentos, compras }, assinatura] = await Promise.all([
    historicoDoUsuario(viewer.id),
    db.subscription.findUnique({ where: { userId: viewer.id } }),
  ]);

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
        planoNome={planLabel(viewer.entitlement.plan)}
        premium={viewer.entitlement.premium}
        episodiosGratis={viewer.entitlement.freePreviewEpisodes}
        renovaEm={viewer.entitlement.currentPeriodEnd?.toISOString() ?? null}
        canceladaNoFim={assinatura?.cancelAtPeriodEnd ?? false}
        status={viewer.entitlement.status}
        compras={compras.map((c) => ({
          id: c.id,
          data: c.createdAt.toISOString(),
          valorCents: c.amountCents,
          status: c.status,
          novela: { slug: c.novela.slug, titulo: c.novela.title },
        }))}
        pagamentos={pagamentos.map((p) => ({
          id: p.id,
          data: p.createdAt.toISOString(),
          valorCents: p.amountCents,
          status: p.status,
          metodo: p.method,
          plano: p.plan,
          reembolsadoCents: p.refundedCents,
        }))}
      />
    </div>
  );
}
