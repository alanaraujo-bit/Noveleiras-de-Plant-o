import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import {
  getCompletas,
  getEmBreve,
  getFeatured,
  getComecePorAqui,
  getNovidades,
  getParaVoce,
  getPopulares,
  listGenres,
} from "@/lib/repositories/catalog";
import { getContinueWatching } from "@/lib/repositories/progresso";
import { getFeed } from "@/lib/repositories/feed";
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
    generos,
    completas,
    comecePorAqui,
    emBreve,
    feed,
  ] = await Promise.all([
    getFeatured(4),
    getContinueWatching(viewer.id, 8),
    getNovidades(12),
    getPopulares(12),
    listGenres(),
    getCompletas(10),
    getComecePorAqui(10),
    getEmBreve(4),
    getFeed(viewer.id, { take: 2 }),
  ]);

  const paraVoce = await getParaVoce(
    viewer.preferences.favoriteGenreIds,
    continuar.map((item) => item.novelaId),
    10,
  );

  const primeiroNome = viewer.name.split(" ")[0];

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

        {paraVoce.length > 0 ? (
          <section>
            <TituloSecao sobretitulo={`Pelo seu gosto, ${primeiroNome}`}>
              Escolhidas para você
            </TituloSecao>
            <TrilhoCapas novelas={paraVoce} largura="larga" />
          </section>
        ) : null}

        <section>
          <TituloSecao
            sobretitulo="Todo mundo comentando"
            acao={
              <Link
                href="/generos"
                className="tap -my-2 inline-flex items-center gap-1 py-2 text-[0.8125rem] font-semibold text-cream-400"
              >
                Gêneros
                <IconeSeta tamanho={14} />
              </Link>
            }
          >
            Populares agora
          </TituloSecao>
          <TrilhoCapas novelas={populares} />
        </section>

        <section>
          <TituloSecao sobretitulo="Por onde você quer entrar">
            Gêneros
          </TituloSecao>
          <div className="rail no-scrollbar pb-1">
            {generos.map((genero) => (
              <Link
                key={genero.id}
                href={`/generos/${genero.slug}`}
                className="tap rail-item relative w-[13rem] overflow-hidden rounded-card border border-white/8"
                style={{ aspectRatio: "3 / 2" }}
              >
                <img
                  src={genero.artUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-3.5">
                  <h3 className="text-[1.0625rem] leading-tight">{genero.name}</h3>
                  <p className="mt-0.5 line-clamp-1 text-[0.75rem] text-cream-400">
                    {genero.tagline}
                  </p>
                </div>
              </Link>
            ))}
            <span className="w-1 shrink-0" aria-hidden />
          </div>
        </section>

        <Divisoria />

        {feed.length > 0 ? (
          <section>
            <TituloSecao
              sobretitulo="A comunidade está de plantão"
              acao={
                <Link
                  href="/feed"
                  className="tap -my-2 inline-flex items-center gap-1 py-2 text-[0.8125rem] font-semibold text-cream-400"
                >
                  Ver tudo
                  <IconeSeta tamanho={14} />
                </Link>
              }
            >
              Comentários de hoje
            </TituloSecao>
            <div className="space-y-2.5 px-5">
              {feed.map((post) => (
                <Link
                  key={post.id}
                  href="/feed"
                  className="tap surface-card block rounded-card p-3.5"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      nome={post.author.name}
                      seed={post.author.avatarSeed}
                      fotoUrl={post.author.avatarUrl}
                      tamanho={30}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8125rem] font-semibold text-cream-50">
                        {post.author.name}
                      </p>
                      <p className="truncate text-[0.6875rem] text-cream-600">
                        {post.novela ? post.novela.title : "No plantão geral"} ·{" "}
                        {formatRelative(post.createdAt)}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-[0.75rem] font-semibold text-cream-600">
                      <IconeConversa tamanho={15} />
                      {post.commentCount}
                    </span>
                  </div>
                  <p
                    className={`selectable mt-2.5 text-[0.875rem] leading-relaxed text-cream-200 ${
                      post.spoiler && viewer.preferences.spoilerGuard
                        ? "blur-[5px] select-none"
                        : "line-clamp-3"
                    }`}
                  >
                    {post.body}
                  </p>
                  {post.spoiler && viewer.preferences.spoilerGuard ? (
                    <p className="mt-1.5 text-[0.75rem] font-semibold text-gold-400">
                      Contém spoiler — abra no plantão para ler
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

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
