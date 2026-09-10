import Link from "next/link";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  BarraDeFiltros,
  CampoDeBusca,
  Paginacao,
  Seletor,
} from "@/components/painel/Filtros";
import { AcoesDaDenuncia, AcoesDoPost } from "@/components/painel/ComunidadeAcoes";
import {
  CelulaDeAutor,
  ROTULO_DE_TIPO,
  SeloDeEstado,
} from "@/components/painel/Comunidade";
import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
  Tabela,
  Td,
  Th,
  Vazio,
} from "@/components/painel/primitivos";
import {
  CARMIM,
  GraficoArea,
  Legenda,
  NEUTRO,
  SERIES,
} from "@/components/painel/graficos";
import { IconeComunidade } from "@/components/painel/icones";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  listarDenuncias,
  listarPosts,
  resumoDaComunidade,
} from "@/lib/painel/metricas/comunidade";
import {
  fmtDataHora,
  fmtDuracao,
  fmtNumero,
} from "@/lib/painel/numeros";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Comunidade" };

type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDaComunidade({
  searchParams,
}: {
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("comunidade.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });
  const sufixo = sufixoDoPeriodo(params);
  const podeModerar = operador.pode("comunidade.moderar");
  const podeAbrirContas = operador.pode("usuarios.ver");

  const [resumo, posts, denuncias] = await Promise.all([
    resumoDaComunidade(periodo),
    listarPosts({
      periodo,
      termo: params.q,
      situacao: params.situacao,
      pagina: Number(params.pagina ?? 1),
    }),
    // A fila de moderação ignora o período de propósito: uma denúncia de três
    // meses atrás que ninguém decidiu continua sendo trabalho pendente hoje.
    listarDenuncias({ periodo, apenasPendentes: true, porPagina: 10 }),
  ]);

  return (
    <>
      <Cabecalho
        titulo="Comunidade"
        descricao={`${periodo.rotulo} · ${fmtNumero(resumo.posts.valor)} ${resumo.posts.valor === 1 ? "publicação" : "publicações"} · ${fmtNumero(resumo.denunciasAbertas)} ${resumo.denunciasAbertas === 1 ? "denúncia esperando decisão" : "denúncias esperando decisão"}`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco
            titulo="O que a comunidade publicou"
            descricao="Publicações e comentários registrados ao longo do recorte"
            acao={
              <Legenda
                itens={[
                  { nome: periodo.rotulo, cor: CARMIM },
                  { nome: "Período anterior", cor: NEUTRO, tracejado: true },
                  { nome: "Comentários", cor: SERIES[0] },
                ]}
              />
            }
          >
            <GraficoArea
              altura={250}
              formato="compacto"
              rotuloEixo="Publicações"
              vazio="Ninguém publicou nada neste recorte"
              series={[
                {
                  nome: periodo.rotulo,
                  pontos: resumo.series.posts,
                  cor: CARMIM,
                },
                {
                  nome: "Período anterior",
                  pontos: resumo.series.postsAnterior,
                  fantasma: true,
                },
                {
                  nome: "Comentários",
                  pontos: resumo.series.comentarios,
                  cor: SERIES[0],
                },
              ]}
            />
          </Bloco>

          <Bloco titulo="Conversa e moderação" descricao={periodo.rotulo}>
            <Razao>
              <LinhaRazao
                rotulo="Publicações"
                valor={fmtNumero(resumo.posts.valor)}
                indicador={resumo.posts}
                destaque
              />
              <LinhaRazao
                rotulo="Comentários"
                valor={fmtNumero(resumo.comentarios.valor)}
                indicador={resumo.comentarios}
              />
              <LinhaRazao
                rotulo="Curtidas"
                valor={fmtNumero(resumo.curtidas.valor)}
                indicador={resumo.curtidas}
              />
              <LinhaRazao
                rotulo="Pessoas publicando"
                valor={fmtNumero(resumo.autores.valor)}
                indicador={resumo.autores}
                nota="só contas identificadas — publicar exige entrar"
              />
              <LinhaRazao
                rotulo="Denúncias no período"
                valor={fmtNumero(resumo.denunciasNoPeriodo.valor)}
                indicador={resumo.denunciasNoPeriodo}
                sentido="menor-melhor"
              />
              <LinhaRazao
                rotulo="Tempo até decidir"
                valor={
                  resumo.tempoMedioDeResolucaoMs === null
                    ? "—"
                    : fmtDuracao(resumo.tempoMedioDeResolucaoMs)
                }
                sentido="menor-melhor"
                nota="média entre a denúncia e o seu desfecho"
              />
              <LinhaRazao
                rotulo="Conteúdo oculto"
                valor={fmtNumero(resumo.ocultos + resumo.comentariosOcultos)}
                sentido="menor-melhor"
                nota={`${fmtNumero(resumo.ocultos)} publicações · ${fmtNumero(resumo.comentariosOcultos)} comentários — acumulado, não do período`}
              />
            </Razao>
          </Bloco>
        </div>

        {/* ------------------------------------------- fila de moderação */}
        <section className="painel-cartao overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] px-5 py-4">
            <div>
              <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                Esperando decisão
              </h2>
              <p className="mt-0.5 max-w-[70ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
                Denúncias abertas ou em análise, de qualquer data — trabalho
                pendente não obedece ao recorte de período. Resolver a denúncia
                e ocultar o conteúdo são ações separadas.
              </p>
            </div>
            {denuncias.total > denuncias.linhas.length ? (
              <Selo tom="atencao">
                {fmtNumero(denuncias.total)} na fila
              </Selo>
            ) : null}
          </header>
          {denuncias.linhas.length === 0 ? (
            <Vazio
              icone={<IconeComunidade tamanho={28} />}
              titulo="Nenhuma denúncia esperando decisão"
              descricao="A fila está limpa. Quando alguém denunciar uma publicação, um comentário ou uma conta, ela aparece aqui até ser resolvida ou arquivada."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Alvo</Th>
                  <Th>Motivo</Th>
                  <Th>Quem denunciou</Th>
                  <Th>Estado</Th>
                  <Th alinhar="direita">Aberta em</Th>
                  <Th alinhar="direita">
                    <span className="sr-only">Decidir</span>
                  </Th>
                </tr>
              }
            >
              {denuncias.linhas.map((denuncia) => (
                <tr key={denuncia.id} className="painel-linha">
                  <Td>
                    <span className="block max-w-[22rem]">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[0.6875rem] text-[var(--p-fraco)] uppercase">
                          {denuncia.tipoDoAlvo.toLowerCase()}
                        </span>
                        {denuncia.alvoOculto ? (
                          <Selo tom="neutro">já oculto</Selo>
                        ) : null}
                        {!denuncia.alvoExiste ? (
                          <Selo tom="neutro">alvo removido</Selo>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate">
                        {denuncia.previa ?? "conteúdo não encontrado"}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="block max-w-[14rem]">
                      <span className="block truncate">{denuncia.motivo}</span>
                      {denuncia.detalhe ? (
                        <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                          {denuncia.detalhe}
                        </span>
                      ) : null}
                    </span>
                  </Td>
                  <CelulaDeAutor
                    autor={denuncia.quemDenunciou}
                    podeAbrirContas={podeAbrirContas}
                    ausente={
                      denuncia.anonima ? "sem autor registrado" : "conta removida"
                    }
                  />
                  <Td>
                    <SeloDeEstado estado={denuncia.estado} />
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {fmtDataHora(denuncia.criadaEm)}
                  </Td>
                  <Td alinhar="direita">
                    <AcoesDaDenuncia
                      denunciaId={denuncia.id}
                      estado={denuncia.estado}
                      podeModerar={podeModerar}
                    />
                  </Td>
                </tr>
              ))}
            </Tabela>
          )}
        </section>

        {/* ------------------------------------------------- publicações */}
        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Publicações
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              Abra uma publicação para ler os comentários e moderar linha a linha
            </p>
          </header>
          <BarraDeFiltros>
            <CampoDeBusca placeholder="Buscar no texto…" />
            <Seletor
              chave="tipo"
              rotulo="Filtrar por tipo"
              opcoes={[
                { valor: "", rotulo: "Todo tipo" },
                { valor: "THOUGHT", rotulo: "Comentário solto" },
                { valor: "REVIEW", rotulo: "Resenha" },
                { valor: "THEORY", rotulo: "Teoria" },
              ]}
            />
            <Seletor
              chave="situacao"
              rotulo="Filtrar por situação"
              opcoes={[
                { valor: "", rotulo: "Tudo" },
                { valor: "visiveis", rotulo: "Só visíveis" },
                { valor: "ocultos", rotulo: "Só ocultos" },
                { valor: "denunciados", rotulo: "Só denunciados" },
              ]}
            />
          </BarraDeFiltros>
          {posts.linhas.length === 0 ? (
            <Vazio
              icone={<IconeComunidade tamanho={28} />}
              titulo={
                params.q || params.tipo || params.situacao
                  ? "Nenhuma publicação corresponde a este filtro"
                  : "Ninguém publicou nada neste recorte"
              }
              descricao="A tabela lista o que existe em Post; conteúdo oculto continua aqui, porque moderação sem histórico é moderação irrevisável."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Publicação</Th>
                  <Th>Autor</Th>
                  <Th>Sobre</Th>
                  <Th alinhar="direita">Curtidas</Th>
                  <Th alinhar="direita">Comentários</Th>
                  <Th alinhar="direita">Quando</Th>
                  <Th alinhar="direita">
                    <span className="sr-only">Moderar</span>
                  </Th>
                </tr>
              }
            >
              {posts.linhas.map((post) => (
                <tr key={post.id} className="painel-linha">
                  <Td>
                    <Link
                      href={`/painel/comunidade/${post.id}${sufixo}`}
                      className="block max-w-[26rem]"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        {post.episodio ? (
                          <span className="text-[0.6875rem] text-[var(--p-fraco)]">
                            T{post.episodio.temporada} · ep{" "}
                            {post.episodio.numero}
                          </span>
                        ) : null}
                        {post.spoiler ? <Selo tom="atencao">spoiler</Selo> : null}
                        {post.oculto ? <Selo tom="neutro">oculto</Selo> : null}
                        {post.denunciasAbertas > 0 ? (
                          <Selo tom="perigo">
                            {post.denunciasAbertas}{" "}
                            {post.denunciasAbertas === 1
                              ? "denúncia"
                              : "denúncias"}
                          </Selo>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate hover:text-[var(--color-rose-300)]">
                        {post.corpo}
                      </span>
                    </Link>
                  </Td>
                  <CelulaDeAutor
                    autor={post.autor}
                    podeAbrirContas={podeAbrirContas}
                  />
                  <Td>
                    {post.novela ? (
                      <span className="block max-w-[12rem] truncate text-[0.75rem]">
                        {post.novela.titulo}
                      </span>
                    ) : (
                      <span className="text-[var(--p-fraco)]">—</span>
                    )}
                  </Td>
                  <Td alinhar="direita">{fmtNumero(post.curtidas)}</Td>
                  <Td alinhar="direita">{fmtNumero(post.comentarios)}</Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {fmtDataHora(post.criadoEm)}
                  </Td>
                  <Td alinhar="direita">
                    <AcoesDoPost
                      postId={post.id}
                      oculto={post.oculto}
                      podeModerar={podeModerar}
                    />
                  </Td>
                </tr>
              ))}
            </Tabela>
          )}
          <Paginacao
            pagina={posts.pagina}
            paginas={posts.paginas}
            total={posts.total}
            rotuloItem="publicações"
          />
        </section>
      </Conteudo>
    </>
  );
}
