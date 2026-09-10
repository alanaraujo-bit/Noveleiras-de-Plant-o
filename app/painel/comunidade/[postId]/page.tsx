import Link from "next/link";
import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import {
  AcoesDaDenuncia,
  AcoesDoComentario,
  AcoesDoPost,
} from "@/components/painel/ComunidadeAcoes";
import { ROTULO_DE_TIPO, SeloDeEstado } from "@/components/painel/Comunidade";
import {
  Bloco,
  LinhaRazao,
  Migalhas,
  Razao,
  Selo,
  Vazio,
} from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import { postComComentarios } from "@/lib/painel/metricas/comunidade";
import { fmtDataHora, fmtNumero } from "@/lib/painel/numeros";
import { sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Publicação" };

type Params = Promise<{ postId: string }>;
type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDaPublicacao({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("comunidade.ver");

  const { postId } = await params;
  const busca = await searchParams;
  const sufixo = sufixoDoPeriodo(busca);

  const dados = await postComComentarios(postId);
  if (!dados) notFound();

  const { post, comentarios, denuncias } = dados;
  const podeModerar = operador.pode("comunidade.moderar");
  const podeAbrirContas = operador.pode("usuarios.ver");
  const pendentes = denuncias.filter(
    (denuncia) => denuncia.state === "OPEN" || denuncia.state === "REVIEWING",
  );

  return (
    <>
      <Cabecalho
        titulo="Conversa"
        descricao={`${post.novela.title} · T${post.episode.season.number} · Episódio ${post.episode.number} · ${fmtDataHora(post.createdAt)}`}
        acoes={
          <AcoesDoPost
            postId={post.id}
            oculto={post.hiddenAt !== null}
            podeModerar={podeModerar}
          />
        }
      />

      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Comunidade", href: `/painel/comunidade${sufixo}` },
            { rotulo: "Publicação" },
          ]}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco titulo="O que foi publicado" descricao="Texto integral, como está no banco">
            <div className="flex flex-wrap items-center gap-1.5">
              {post.spoiler ? <Selo tom="atencao">spoiler</Selo> : null}
              {post.hiddenAt ? (
                <Selo tom="neutro">
                  oculto em {fmtDataHora(post.hiddenAt)}
                </Selo>
              ) : (
                <Selo tom="bom">visível no aplicativo</Selo>
              )}
              {pendentes.length > 0 ? (
                <Selo tom="perigo">
                  {pendentes.length}{" "}
                  {pendentes.length === 1
                    ? "denúncia esperando decisão"
                    : "denúncias esperando decisão"}
                </Selo>
              ) : null}
            </div>
            <p className="mt-3 text-[0.875rem] leading-relaxed whitespace-pre-wrap text-[var(--p-texto)]">
              {post.body}
            </p>
          </Bloco>

          <Bloco titulo="Contexto" descricao="Quem escreveu e sobre o quê">
            <Razao>
              <LinhaRazao
                rotulo="Autor"
                valor={post.user ? `@${post.user.handle}` : "conta removida"}
                nota={
                  post.user
                    ? `${post.user.name}${post.user.isDemo ? " · demonstração" : ""}${post.user.status === "SUSPENDED" ? " · suspensa" : ""}`
                    : undefined
                }
                href={
                  post.user && podeAbrirContas
                    ? `/painel/usuarios/${post.user.id}`
                    : undefined
                }
                destaque
              />
              <LinhaRazao
                rotulo="Sobre"
                valor={post.novela ? post.novela.title : "nada específico"}
                nota={
                  post.episode
                    ? `episódio ${post.episode.number} · ${post.episode.title}`
                    : undefined
                }
              />
              <LinhaRazao rotulo="Curtidas" valor={fmtNumero(post._count.likes)} />
              <LinhaRazao
                rotulo="Respostas"
                valor={fmtNumero(post._count.replies)}
                nota="ocultar a raiz tira a conversa inteira de vista"
              />
              <LinhaRazao
                rotulo="Publicado"
                valor={fmtDataHora(post.createdAt)}
              />
            </Razao>
          </Bloco>
        </div>

        {denuncias.length > 0 ? (
          <section className="painel-cartao overflow-hidden">
            <header className="border-b border-[var(--p-linha)] px-5 py-4">
              <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                Denúncias sobre esta publicação
              </h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                Inclui as já decididas — o histórico é o que permite revisar a
                decisão
              </p>
            </header>
            <ul className="divide-y divide-[var(--p-linha)]">
              {denuncias.map((denuncia) => (
                <li
                  key={denuncia.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeloDeEstado estado={denuncia.state} />
                      <span className="text-[0.8125rem] text-[var(--p-texto)]">
                        {denuncia.reason}
                      </span>
                    </div>
                    {denuncia.detail ? (
                      <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
                        {denuncia.detail}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[0.6875rem] text-[var(--p-fraco)]">
                      aberta em {fmtDataHora(denuncia.createdAt)}
                      {denuncia.resolvedAt
                        ? ` · decidida em ${fmtDataHora(denuncia.resolvedAt)}`
                        : ""}
                      {denuncia.resolution ? ` · ${denuncia.resolution}` : ""}
                    </p>
                  </div>
                  <AcoesDaDenuncia
                    denunciaId={denuncia.id}
                    estado={denuncia.state}
                    podeModerar={podeModerar}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Comentários
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              Em ordem cronológica, como a conversa aconteceu
            </p>
          </header>
          {comentarios.length === 0 ? (
            <Vazio
              titulo="Nenhum comentário"
              descricao="Ninguém respondeu a esta publicação."
            />
          ) : (
            <ul className="divide-y divide-[var(--p-linha)]">
              {comentarios.map((comentario) => (
                <li
                  key={comentario.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {comentario.autor ? (
                        podeAbrirContas ? (
                          <Link
                            href={`/painel/usuarios/${comentario.autor.id}`}
                            className="text-[0.8125rem] font-medium hover:text-[var(--color-rose-300)]"
                          >
                            @{comentario.autor.handle}
                          </Link>
                        ) : (
                          <span className="text-[0.8125rem] font-medium">
                            @{comentario.autor.handle}
                          </span>
                        )
                      ) : (
                        <span className="text-[0.8125rem] text-[var(--p-fraco)]">
                          conta removida
                        </span>
                      )}
                      <span className="text-[0.6875rem] text-[var(--p-fraco)]">
                        {fmtDataHora(comentario.criadoEm)}
                      </span>
                      {comentario.oculto ? <Selo tom="neutro">oculto</Selo> : null}
                      {comentario.denunciasAbertas > 0 ? (
                        <Selo tom="perigo">
                          {comentario.denunciasAbertas}{" "}
                          {comentario.denunciasAbertas === 1
                            ? "denúncia"
                            : "denúncias"}
                        </Selo>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-[var(--p-suave)]">
                      {comentario.corpo}
                    </p>
                  </div>
                  <AcoesDoComentario
                    comentarioId={comentario.id}
                    oculto={comentario.oculto}
                    podeModerar={podeModerar}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Conteudo>
    </>
  );
}
