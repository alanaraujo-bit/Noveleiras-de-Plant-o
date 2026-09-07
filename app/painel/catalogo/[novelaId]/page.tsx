import Link from "next/link";
import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  ROTULO_DE_STATUS,
  ROTULO_DE_TIER,
} from "@/components/painel/Catalogo";
import {
  Bloco,
  LinhaRazao,
  Migalhas,
  Razao,
  Selo,
  Tabela,
  Td,
  Th,
  Vazio,
} from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import { novelaNoCatalogo } from "@/lib/painel/metricas/catalogo";
import {
  fmtCompacto,
  fmtDataCurta,
  fmtDuracao,
  fmtNumero,
  fmtRelogio,
} from "@/lib/painel/numeros";
import { sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Novela no catálogo" };

type Params = Promise<{ novelaId: string }>;
type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDaNovelaNoCatalogo({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("catalogo.ver");

  const { novelaId } = await params;
  const busca = await searchParams;
  const sufixo = sufixoDoPeriodo(busca);

  const dados = await novelaNoCatalogo(novelaId);
  if (!dados) notFound();

  const { novela, temporadas } = dados;
  const podeVerStreaming = operador.pode("streaming.ver");
  const lacunas = temporadas.flatMap((temporada) =>
    temporada.lacunas.map((numero) => ({ temporada: temporada.numero, numero })),
  );

  return (
    <>
      <Cabecalho
        titulo={novela.title}
        descricao={`${novela.slug} · ${novela.year} · ${novela.country}`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Catálogo", href: `/painel/catalogo${sufixo}` },
            { rotulo: novela.title },
          ]}
        />

        <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Bloco titulo="Ficha" descricao="O que a edição declarou sobre esta novela">
            <Razao>
              <LinhaRazao
                rotulo="Status"
                valor={ROTULO_DE_STATUS[novela.status] ?? novela.status}
              />
              <LinhaRazao
                rotulo="Acesso"
                valor={ROTULO_DE_TIER[novela.accessTier] ?? novela.accessTier}
                nota={`classificação ${novela.ageRating}`}
              />
              <LinhaRazao
                rotulo="Estreia"
                valor={fmtDataCurta(novela.releasedAt)}
                nota={`atualizada em ${fmtDataCurta(novela.updatedAt)}`}
              />
              <LinhaRazao
                rotulo="Destaque"
                valor={
                  novela.isFeatured
                    ? novela.featuredRank
                      ? `sim · posição ${novela.featuredRank}`
                      : "sim"
                    : "não"
                }
              />
              {/* O nome dos gêneros vai na nota, não no valor: o valor divide
                  a linha com o rótulo e uma lista longa engoliria "Gêneros". */}
              <LinhaRazao
                rotulo="Gêneros"
                valor={
                  novela.generos.length === 0
                    ? "—"
                    : String(novela.generos.length)
                }
                nota={
                  novela.generos.length === 0
                    ? "nenhum gênero associado"
                    : novela.generos.map((genero) => genero.name).join(" · ")
                }
              />
            </Razao>
            {novela.editorialNote ? (
              <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
                {novela.editorialNote}
              </p>
            ) : null}
          </Bloco>

          <Bloco titulo="Inventário" descricao="Contado a partir das linhas do catálogo">
            <Razao>
              <LinhaRazao
                rotulo="Temporadas"
                valor={fmtNumero(temporadas.length)}
                destaque
              />
              <LinhaRazao
                rotulo="Episódios"
                valor={fmtNumero(dados.totalEpisodios)}
              />
              <LinhaRazao
                rotulo="Duração somada"
                valor={fmtDuracao(dados.duracaoSeg * 1000)}
              />
              <LinhaRazao
                rotulo="Lacunas de numeração"
                valor={lacunas.length === 0 ? "nenhuma" : String(lacunas.length)}
                sentido="menor-melhor"
                nota={
                  lacunas.length === 0
                    ? "sequência de episódios não-bônus completa"
                    : `faltando ${lacunas
                        .map((lacuna) => `T${lacuna.temporada}E${lacuna.numero}`)
                        .join(", ")}`
                }
              />
              <LinhaRazao
                rotulo="Avaliação declarada"
                valor={
                  novela.ratingCount === 0
                    ? "—"
                    : `${novela.rating.toFixed(1)} · ${fmtNumero(novela.ratingCount)} votos`
                }
                nota="valor do seed, não coletado do público"
              />
            </Razao>
          </Bloco>

          <Bloco titulo="Contadores contra os fatos" descricao="Coluna do catálogo × evento registrado">
            <Razao>
              <LinhaRazao
                rotulo="viewCount"
                valor={fmtCompacto(novela.viewCount)}
                nota={`fatos: ${fmtCompacto(dados.reproducoesReais)} plays`}
                destaque
              />
              <LinhaRazao
                rotulo="favoriteCount"
                valor={fmtCompacto(novela.favoriteCount)}
                nota={`fatos: ${fmtCompacto(dados.favoritosReais)} favoritos`}
              />
              <LinhaRazao
                rotulo="watchedMs"
                valor={fmtDuracao(novela.watchedMs)}
                nota={`fatos: ${fmtDuracao(dados.tempoRealMs)}`}
              />
            </Razao>
            <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
              Nenhuma métrica do painel lê essas colunas. Elas existem para
              deixar “populares” barato no aplicativo e são reconciliáveis por{" "}
              <code className="rounded bg-[var(--p-elevado)] px-1 py-0.5 text-[0.6875rem] text-[var(--p-suave)]">
                npm run painel:reconciliar
              </code>
              .
            </p>
          </Bloco>
        </div>

        {podeVerStreaming ? (
          <p className="text-[0.75rem] text-[var(--p-fraco)]">
            Para o consumo desta novela — plays, conclusão, abandono e erros —
            veja{" "}
            <Link
              href={`/painel/streaming/${novela.id}${sufixo}`}
              className="text-[var(--color-rose-300)] hover:underline"
            >
              Streaming › {novela.title}
            </Link>
            .
          </p>
        ) : null}

        {temporadas.length === 0 ? (
          <section className="painel-cartao overflow-hidden">
            <Vazio
              titulo="Esta novela ainda não tem temporadas"
              descricao="Sem temporada não há episódio, e sem episódio não há o que reproduzir. Crie a primeira temporada para começar a publicar."
            />
          </section>
        ) : (
          temporadas.map((temporada) => (
            <section key={temporada.id} className="painel-cartao overflow-hidden">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] px-5 py-4">
                <div>
                  <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                    Temporada {temporada.numero} · {temporada.titulo}
                  </h2>
                  <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                    {temporada.episodios.length}{" "}
                    {temporada.episodios.length === 1 ? "episódio" : "episódios"}
                    {temporada.lacunas.length > 0
                      ? ` · faltando ${temporada.lacunas.map((n) => `#${n}`).join(", ")}`
                      : ""}
                  </p>
                </div>
                {temporada.lacunas.length > 0 ? (
                  <Selo tom="atencao">sequência incompleta</Selo>
                ) : null}
              </header>
              {temporada.episodios.length === 0 ? (
                <Vazio
                  titulo="Temporada sem episódios"
                  descricao="A temporada existe no catálogo, mas nada foi publicado dentro dela."
                />
              ) : (
                <Tabela
                  cabecalho={
                    <tr>
                      <Th>#</Th>
                      <Th>Episódio</Th>
                      <Th alinhar="direita">Duração</Th>
                      <Th>Acesso</Th>
                      <Th>Mídia</Th>
                      <Th alinhar="direita">Estreia</Th>
                      <Th alinhar="direita">viewCount</Th>
                      <Th alinhar="direita">Plays reais</Th>
                    </tr>
                  }
                >
                  {temporada.episodios.map((episodio) => (
                    <tr key={episodio.id} className="painel-linha">
                      <Td className="tabular text-[var(--p-fraco)]">
                        {episodio.numero}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          <span className="block max-w-[18rem] truncate">
                            {episodio.titulo}
                          </span>
                          {episodio.bonus ? <Selo tom="info">bônus</Selo> : null}
                        </span>
                      </Td>
                      <Td alinhar="direita" className="whitespace-nowrap">
                        {fmtRelogio(episodio.duracaoSeg)}
                      </Td>
                      <Td>
                        {episodio.tier === "FREE" ? (
                          <span className="text-[var(--p-fraco)]">aberto</span>
                        ) : (
                          <Selo tom="acento">
                            {ROTULO_DE_TIER[episodio.tier] ?? episodio.tier}
                          </Selo>
                        )}
                      </Td>
                      <Td>
                        <span className="block max-w-[16rem] truncate text-[0.6875rem] text-[var(--p-suave)]">
                          {episodio.mediaProvider.toLowerCase()} ·{" "}
                          {episodio.mediaFormat} · {episodio.mediaKey}
                        </span>
                      </Td>
                      <Td alinhar="direita" className="whitespace-nowrap">
                        {fmtDataCurta(episodio.publicadoEm)}
                      </Td>
                      <Td alinhar="direita" className="text-[var(--p-fraco)]">
                        {fmtCompacto(episodio.viewCount)}
                      </Td>
                      <Td alinhar="direita">
                        {episodio.reproducoes === episodio.viewCount ? (
                          fmtCompacto(episodio.reproducoes)
                        ) : (
                          <Selo tom="atencao">
                            {fmtCompacto(episodio.reproducoes)}
                          </Selo>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Tabela>
              )}
            </section>
          ))
        )}
      </Conteudo>
    </>
  );
}
