import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import {
  getCompletas,
  getEmBreve,
  getFeatured,
  getComecePorAqui,
  getNovidades,
  getPopulares,
} from "@/lib/repositories/catalog";
import { getContinueWatching } from "@/lib/repositories/progresso";
import { TopoApp } from "@/components/shell/TopoApp";
import { Destaques } from "@/components/novela/Destaques";
import {
  Capa,
  TrilhoCapas,
  TrilhoContinuar,
} from "@/components/novela/cartoes";
import {
  Avatar,
  BotaoLink,
  Divisoria,
  TituloSecao,
} from "@/components/ui/primitivos";
import { IconeConversa, IconeSeta } from "@/components/ui/icones";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Início" };

export default async function InicioPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/bem-vindo");

  const [
    destaques,
    continuar,
    novidades,
    populares,
    completas,
    comecePorAqui,
    emBreve,
  ] = await Promise.all([
    getFeatured(4),
    getContinueWatching(viewer.id, 8),
    getNovidades(12),
    getPopulares(12),
    getCompletas(10),
    getComecePorAqui(10),
    getEmBreve(4),
  ]);

  return (
    <>
      <TopoApp
        nome={viewer.name}
        avatarSeed={viewer.avatarSeed}
        avatarUrl={viewer.avatarUrl}
      />

      <div className="space-y-9 pt-1">
        <Destaques novelas={destaques} />

        {continuar.length > 0 ? (
          <section>
            <TituloSecao
              sobretitulo="De onde você parou"
              acao={
                <Link
                  href="/perfil/historico"
                  className="tap -my-2 inline-flex items-center gap-1 py-2 text-[0.8125rem] font-semibold text-cream-400"
                >
                  Histórico
                  <IconeSeta tamanho={14} />
                </Link>
              }
            >
              Continuar assistindo
            </TituloSecao>
            <TrilhoContinuar itens={continuar} />
          </section>
        ) : (
          <section>
            <TituloSecao sobretitulo="Comece por aqui">
              Escolha a primeira
            </TituloSecao>
            <p className="mb-3.5 px-5 text-[0.875rem] leading-relaxed text-cream-400">
              Episódios de dois minutos, histórias inteiras. Os{" "}
              {viewer.entitlement.freePreviewEpisodes} primeiros de qualquer uma
              são grátis, sem cartão.
            </p>
            <TrilhoCapas novelas={comecePorAqui} largura="larga" prioridade />
          </section>
        )}

        <section>
          <TituloSecao sobretitulo="Chegaram esta semana">
            Novidades no plantão
          </TituloSecao>
          <TrilhoCapas novelas={novidades} />
        </section>

        <section>
          <TituloSecao sobretitulo="Todo mundo comentando">
            Populares agora
          </TituloSecao>
          <TrilhoCapas novelas={populares} />
        </section>

        <section>
          <TituloSecao sobretitulo="Começo, meio e fim no mesmo dia">
            Novelas completas
          </TituloSecao>
          <TrilhoCapas novelas={completas} />
        </section>

        {emBreve.length > 0 ? (
          <section>
            <TituloSecao sobretitulo="Anote na agenda">Em breve</TituloSecao>
            <div className="grid grid-cols-2 gap-3 px-5">
              {emBreve.map((novela) => (
                <Capa key={novela.id} novela={novela} largura="cheia" />
              ))}
            </div>
          </section>
        ) : null}

        {!viewer.entitlement.premium ? (
          <section className="px-5">
            <div
              className="warm-glow overflow-hidden rounded-panel border border-gold-400/20 p-6 text-center"
              style={{
                background:
                  "linear-gradient(165deg, rgb(217 163 85 / 0.14), rgb(42 21 35 / 0.9))",
              }}
            >
              <p className="eyebrow">Assine o Plantão</p>
              <h2 className="mt-1.5 text-[1.375rem] leading-tight">
                Passou do {viewer.entitlement.freePreviewEpisodes}º episódio? Continue sem parar
              </h2>
              <p className="mx-auto mt-2 max-w-[20rem] text-[0.875rem] leading-relaxed text-cream-200">
                Catálogo inteiro por R,99 por mês, ou R,90 no ano. Sem
                fidelidade e em todos os seus aparelhos.
              </p>
              <BotaoLink
                href="/planos"
                variante="ouro"
                tamanho="grande"
                className="mt-5"
              >
                Ver os planos
              </BotaoLink>
            </div>
          </section>
        ) : null}

      </div>
    </>
  );
}
