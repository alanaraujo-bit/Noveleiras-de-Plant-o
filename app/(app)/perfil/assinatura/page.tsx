import Link from "next/link";
import { redirect } from "next/navigation";

import { IconeVoltar } from "@/components/ui/icones";
import { planLabel } from "@/lib/access/entitlements";
import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mensagemDeRenovacao } from "@/lib/pagamentos/ciclo";
import { situacaoDaRenovacao } from "@/lib/pagamentos/renovacao";
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

  const renovacao = situacaoDaRenovacao(assinatura);
  const mensagem = renovacao.aviso ? mensagemDeRenovacao(renovacao.aviso) : null;

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
        manual={renovacao.manual}
        renovarAte={renovacao.renovarAte?.toISOString() ?? null}
        aviso={
          renovacao.aviso && mensagem
            ? { momento: renovacao.aviso.momento, ...mensagem }
            : null
        }
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
          // O extrato precisa separar "mensalidade do cartão" de "renovação
          // por Pix": são a mesma quantia e significam coisas diferentes para
          // quem confere a fatura.
          renovacao: p.billingMode,
          reembolsadoCents: p.refundedCents,
        }))}
      />
    </div>
  );
}
