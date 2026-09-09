import Link from "next/link";
import { redirect } from "next/navigation";

import { Planos, type PlanoNaTela } from "@/components/pagamento/Planos";
import { IconeVoltar } from "@/components/ui/icones";
import { planLabel } from "@/lib/access/entitlements";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  economiaAnualCents,
  mensalEquivalenteDoAnual,
  PLANOS_VENDAVEIS,
} from "@/lib/pagamentos/planos";

export const metadata = {
  title: "Planos",
  description: "Assine o Plantão e veja o catálogo inteiro.",
};

/**
 * Vitrine dos planos.
 *
 * Server component: o catálogo comercial nunca chega ao cliente por outra via
 * senão esta, e o preço mostrado é o mesmo que o servidor vai cobrar. Não há
 * nada aqui que o navegador possa alterar para mudar o valor.
 */
export default async function PlanosPage({
  searchParams,
}: {
  searchParams: Promise<{ destino?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar?proximo=/planos");

  const { destino } = await searchParams;

  // O cancelamento marca `cancelAtPeriodEnd` e deixa o status ACTIVE — quem
  // pagou até o dia 30 assiste até o dia 30. Ler `status === "CANCELED"` aqui
  // faria esta tela anunciar "renova em X" para alguém que já cancelou,
  // divergindo da tela de assinatura, que lê a coluna certa.
  const assinatura = await db.subscription.findUnique({
    where: { userId: viewer.id },
    select: { cancelAtPeriodEnd: true },
  });

  const planos: PlanoNaTela[] = PLANOS_VENDAVEIS.map((p) => ({
    code: p.code as "MONTHLY" | "ANNUAL",
    nome: p.nome,
    descricao: p.descricao,
    precoCents: p.precoCents,
    intervalo: p.intervalo,
    beneficios: p.beneficios,
    cor: p.cor,
  }));

  return (
    <div>
      <header
        className="flex items-center gap-2 px-4 pb-4"
        style={{ paddingTop: "calc(var(--safe-t) + 1rem)" }}
      >
        <Link
          href="/perfil"
          aria-label="Voltar"
          className="tap grid size-10 place-items-center rounded-full text-cream-200 hover:bg-white/8"
        >
          <IconeVoltar tamanho={20} />
        </Link>
        <div>
          <p className="eyebrow">Sem anúncio, sem espera</p>
          <h1 className="text-[1.5rem] leading-tight">Assine o Plantão</h1>
        </div>
      </header>

      <Planos
        planos={planos}
        gratuitos={viewer.entitlement.freePreviewEpisodes}
        economiaCents={economiaAnualCents()}
        mensalEquivalenteCents={mensalEquivalenteDoAnual()}
        destino={destino}
        atual={{
          premium: viewer.entitlement.premium,
          plano: viewer.entitlement.plan,
          planoNome: planLabel(viewer.entitlement.plan),
          renovaEm: viewer.entitlement.currentPeriodEnd?.toISOString() ?? null,
          cancelado: assinatura?.cancelAtPeriodEnd ?? false,
        }}
      />
    </div>
  );
}
