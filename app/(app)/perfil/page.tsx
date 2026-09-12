import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { getViewerStats } from "@/lib/repositories/progresso";
import { planLabel } from "@/lib/access/entitlements";
import { sair } from "@/lib/actions/conta";
import { Selo } from "@/components/ui/primitivos";
import { BotaoInstalar } from "@/components/sistema/BotaoInstalar";
import { EditorFotoCabecalho } from "@/components/perfil/EditorFotoCabecalho";
import { FaixaDeRenovacao } from "@/components/pagamento/FaixaDeRenovacao";
import { db } from "@/lib/db";
import { mensagemDeRenovacao } from "@/lib/pagamentos/ciclo";
import { situacaoDaRenovacao } from "@/lib/pagamentos/renovacao";
import {
  IconeCoracao,
  IconeHistorico,
  IconePerfil,
  IconeSeta,
} from "@/components/ui/icones";
import { formatMinutes } from "@/lib/format";

export const metadata = { title: "Perfil" };

export default async function PerfilPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const [stats, assinatura] = await Promise.all([
    getViewerStats(viewer.id),
    db.subscription.findUnique({ where: { userId: viewer.id } }),
  ]);
  const { entitlement } = viewer;

  // Quem renova à mão é lembrado aqui, e só aqui dentro do perfil: a Home é
  // para assistir. O aviso some sozinho quando não há nada a fazer.
  const renovacao = situacaoDaRenovacao(assinatura);
  // "Seu Plantão terminou" é um aviso, não um estado permanente do perfil.
  // Passado um mês, lembrar toda vez que ela abre o perfil vira insistência —
  // a tela de assinatura continua contando a história para quem for ver.
  const avisoVigente =
    renovacao.aviso &&
    !(renovacao.aviso.momento === "encerrado" && renovacao.aviso.diasParaVencer < -30)
      ? renovacao.aviso
      : null;
  const mensagem = avisoVigente ? mensagemDeRenovacao(avisoVigente) : null;

  const atalhos = [
    {
      href: "/minha-lista",
      titulo: "Minha lista",
      descricao: `${stats.favorites} ${stats.favorites === 1 ? "novela guardada" : "novelas guardadas"}`,
      Icone: IconeCoracao,
    },
    {
      href: "/perfil/historico",
      titulo: "Histórico",
      descricao: `${stats.episodesStarted} ${stats.episodesStarted === 1 ? "episódio" : "episódios"} no seu registro`,
      Icone: IconeHistorico,
    },
    {
      href: "/perfil/preferencias",
      titulo: "Preferências",
      descricao: "Reprodução, spoilers, dados e avisos",
      Icone: IconePerfil,
    },
  ];

  return (
    <div>
      <header
        className="px-5 pb-6"
        style={{ paddingTop: "calc(var(--safe-t) + 1.5rem)" }}
      >
        <EditorFotoCabecalho
          nome={viewer.name}
          handle={viewer.handle}
          avatarSeed={viewer.avatarSeed}
          avatarUrl={viewer.avatarUrl}
        />

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <Selo tom={entitlement.premium ? "ouro" : "neutro"}>
            {planLabel(entitlement.plan)}
          </Selo>
          {entitlement.premium && entitlement.currentPeriodEnd ? (
            <span className="text-[0.75rem] text-cream-600">
              {/* "renova em" seria promessa falsa para quem paga por Pix:
                  ninguém vai cobrar nada sozinho. */}
              {renovacao.manual ? "vale até " : "renova em "}
              {new Intl.DateTimeFormat("pt-BR", {
                day: "2-digit",
                month: "short",
              }).format(entitlement.currentPeriodEnd)}
            </span>
          ) : null}
        </div>
      </header>

      {mensagem && avisoVigente ? (
        <div className="px-5 pb-5">
          <FaixaDeRenovacao
            compacta
            momento={avisoVigente.momento}
            titulo={mensagem.titulo}
            detalhe={mensagem.detalhe}
            acao={mensagem.acao}
          />
        </div>
      ) : null}

      {/* Resumo de consumo -------------------------------------------------- */}
      <section className="px-5">
        <div className="surface-card grid grid-cols-3 divide-x divide-white/8 rounded-panel py-4">
          <Metrica
            valor={formatMinutes(stats.watchedMinutes)}
            rotulo="assistidos"
          />
          <Metrica
            valor={String(stats.episodesCompleted)}
            rotulo={stats.episodesCompleted === 1 ? "episódio" : "episódios"}
          />
          <Metrica
            valor={String(stats.novelasStarted)}
            rotulo={stats.novelasStarted === 1 ? "novela" : "novelas"}
          />
        </div>
      </section>

      {/* Assinatura --------------------------------------------------------- */}
      <section className="mt-4 px-5">
        <Link
          href="/perfil/assinatura"
          className="tap block overflow-hidden rounded-panel border p-4"
          style={{
            borderColor: entitlement.premium
              ? "rgb(233 189 120 / 0.28)"
              : "rgb(255 255 255 / 0.09)",
            background: entitlement.premium
              ? "linear-gradient(150deg, rgb(217 163 85 / 0.16), rgb(42 21 35 / 0.85))"
              : "linear-gradient(150deg, rgb(196 42 85 / 0.16), rgb(42 21 35 / 0.85))",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Assinatura</p>
              <p className="mt-1 text-[1.0625rem] font-display font-semibold leading-tight text-cream-50">
                {entitlement.premium
                  ? "Você tem o catálogo inteiro liberado"
                  : "Desbloqueie todos os episódios"}
              </p>
              <p className="mt-1 text-[0.8125rem] leading-snug text-cream-400">
                {entitlement.premium
                  ? "Gerenciar plano e forma de pagamento"
                  : `No plano gratuito você vê os ${entitlement.freePreviewEpisodes} primeiros episódios de cada novela.`}
              </p>
            </div>
            <span className="shrink-0 text-cream-400">
              <IconeSeta tamanho={19} />
            </span>
          </div>
        </Link>
      </section>

      {/* Atalhos ------------------------------------------------------------ */}
      <nav className="mt-4 px-5">
        <ul className="surface-card divide-y divide-white/8 overflow-hidden rounded-panel">
          {atalhos.map(({ href, titulo, descricao, Icone }) => (
            <li key={href}>
              <Link href={href} className="tap flex items-center gap-3.5 px-4 py-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/6 text-cream-200">
                  <Icone tamanho={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-semibold text-cream-50">
                    {titulo}
                  </span>
                  <span className="block truncate text-[0.8125rem] text-cream-600">
                    {descricao}
                  </span>
                </span>
                <span className="shrink-0 text-cream-600">
                  <IconeSeta tamanho={17} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4 px-5">
        <BotaoInstalar />
      </div>

      <div className="mt-4 px-5">
        <form action={sair}>
          <button
            type="submit"
            className="tap flex h-13 w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.03] text-[0.9375rem] font-semibold text-cream-200"
          >
            Sair da conta
          </button>
        </form>
      </div>

      <p className="mt-6 px-8 text-center text-[0.75rem] leading-relaxed text-cream-600">
        Noveleiras de Plantão
      </p>
    </div>
  );
}

function Metrica({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="px-2 text-center">
      <p className="font-display text-[1.375rem] font-semibold leading-tight text-cream-50">
        {valor}
      </p>
      <p className="mt-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-cream-600">
        {rotulo}
      </p>
    </div>
  );
}
