import Link from "next/link";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  Alternador,
  BarraDeFiltros,
  CampoDeBusca,
  Paginacao,
  Seletor,
} from "@/components/painel/Filtros";
import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
  Vazio,
} from "@/components/painel/primitivos";
import {
  BarrasRanking,
  CARMIM,
  GraficoArea,
  Legenda,
  SERIES,
} from "@/components/painel/graficos";
import { IconeLogs } from "@/components/painel/icones";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  CANAIS,
  listarLogs,
  NIVEIS,
  resumoDeLogs,
} from "@/lib/painel/metricas/logs";
import { fmtDataHora, fmtDesde, fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Logs" };

type Busca = Promise<Record<string, string | undefined>>;

function tomDoNivel(nivel: string) {
  if (nivel === "FATAL" || nivel === "ERROR") return "perigo" as const;
  if (nivel === "WARN") return "atencao" as const;
  if (nivel === "DEBUG") return "neutro" as const;
  return "info" as const;
}

export default async function PaginaDeLogs({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("logs.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });

  const [resumo, registro] = await Promise.all([
    resumoDeLogs(periodo),
    listarLogs({
      periodo,
      termo: params.q,
      nivel: params.nivel,
      canal: params.canal,
      correlacao: params.correlacao,
      apenasProblemas: params.problemas === "1",
      pagina: Number(params.pagina ?? 1),
    }),
  ]);

  const investigando = Boolean(params.correlacao);
  const filtrando = Boolean(
    params.q || params.nivel || params.canal || params.problemas === "1",
  );

  return (
    <>
      <Cabecalho
        titulo="Logs"
        descricao={`${periodo.rotulo} · ${fmtNumero(resumo.total)} ${resumo.total === 1 ? "linha registrada" : "linhas registradas"}`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        {investigando ? (
          <section className="painel-cartao flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-2 border-l-[var(--p-acento)] px-5 py-3.5">
            <span className="text-[0.8125rem] text-[var(--p-texto)]">
              Investigando a correlação{" "}
              <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem]">
                {params.correlacao}
              </code>
            </span>
            <span className="text-[0.75rem] text-[var(--p-fraco)]">
              O período foi ignorado: a história pode ter começado antes do
              recorte. Ordem cronológica crescente.
            </span>
            <Link
              href="/painel/logs"
              className="ml-auto text-[0.75rem] text-[var(--color-rose-300)] hover:underline"
            >
              Sair da investigação
            </Link>
          </section>
        ) : null}

        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco
            titulo="O que o sistema registrou"
            descricao="Todas as linhas e, separadamente, as que são problema"
            acao={
              <Legenda
                itens={[
                  { nome: "Todas", cor: CARMIM },
                  { nome: "Erros e fatais", cor: SERIES[1] },
                ]}
              />
            }
          >
            <GraficoArea
              altura={220}
              formato="compacto"
              rotuloEixo="Linhas"
              vazio="Nenhuma linha de log neste recorte"
              series={[
                { nome: "Todas", pontos: resumo.serie, cor: CARMIM },
                {
                  nome: "Erros e fatais",
                  pontos: resumo.serieProblemas,
                  cor: SERIES[1],
                },
              ]}
            />
          </Bloco>

          <Bloco titulo="Severidade" descricao={periodo.rotulo}>
            <Razao>
              <LinhaRazao
                rotulo="Linhas"
                valor={fmtNumero(resumo.total)}
                destaque
              />
              <LinhaRazao
                rotulo="Erros e fatais"
                valor={fmtNumero(resumo.problemas)}
                sentido="menor-melhor"
                nota={
                  resumo.fatais > 0
                    ? `${fmtNumero(resumo.fatais)} ${resumo.fatais === 1 ? "fatal" : "fatais"}`
                    : "nenhum fatal"
                }
              />
              <LinhaRazao
                rotulo="Investigações"
                valor={fmtNumero(resumo.correlacoes)}
                nota="chaves de correlação distintas"
              />
              <LinhaRazao
                rotulo="Última linha"
                valor={resumo.ultimo ? fmtDesde(resumo.ultimo) : "nenhuma"}
                nota={resumo.ultimo ? fmtDataHora(resumo.ultimo) : undefined}
              />
            </Razao>
            {resumo.total === 0 ? (
              <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
                {resumo.primeiro
                  ? "Nenhuma linha neste recorte, mas a central já registrou antes — experimente ampliar o período."
                  : "A central está no ar e nunca registrou nada. A instrumentação existe em lib/painel/log.ts; os pontos que a chamam ainda estão sendo ligados conforme cada parte do sistema entra em operação."}
              </p>
            ) : null}
          </Bloco>
        </div>

        {resumo.porCanal.length > 0 || resumo.recorrentes.length > 0 ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {resumo.porCanal.length > 0 ? (
              <Bloco titulo="Por canal" descricao="Onde o sistema mais fala">
                <BarrasRanking
                  formato="numero"
                  itens={resumo.porCanal.map((linha) => ({
                    chave: linha.canal,
                    rotulo: linha.canal.toLowerCase(),
                    valor: linha.total,
                  }))}
                />
              </Bloco>
            ) : null}
            {resumo.recorrentes.length > 0 ? (
              <Bloco
                titulo="Mensagens repetidas"
                descricao="Ruído recorrente costuma ser sintoma, não acaso"
              >
                <BarrasRanking
                  formato="numero"
                  cor={SERIES[1]}
                  itens={resumo.recorrentes.map((linha) => ({
                    chave: linha.mensagem,
                    rotulo: linha.mensagem,
                    valor: linha.total,
                    nota: linha.nivel.toLowerCase(),
                  }))}
                />
              </Bloco>
            ) : null}
          </div>
        ) : null}

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Registro
            </h2>
            <p className="mt-0.5 max-w-[74ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
              Clique numa correlação para remontar a história inteira: a mesma
              falha aparece em canais diferentes com a mesma chave.
            </p>
          </header>
          {!investigando ? (
            <BarraDeFiltros>
              <CampoDeBusca placeholder="Buscar mensagem, caminho ou ID…" />
              <Alternador chave="problemas" rotulo="Só erros e fatais" />
              <Seletor
                chave="nivel"
                rotulo="Filtrar por nível"
                opcoes={[
                  { valor: "", rotulo: "Todo nível" },
                  ...NIVEIS.map((nivel) => ({
                    valor: nivel,
                    rotulo: nivel.toLowerCase(),
                  })),
                ]}
              />
              <Seletor
                chave="canal"
                rotulo="Filtrar por canal"
                opcoes={[
                  { valor: "", rotulo: "Todo canal" },
                  ...CANAIS.map((canal) => ({
                    valor: canal,
                    rotulo: canal.toLowerCase(),
                  })),
                ]}
              />
            </BarraDeFiltros>
          ) : null}

          {registro.linhas.length === 0 ? (
            <Vazio
              icone={<IconeLogs tamanho={28} />}
              titulo={
                filtrando
                  ? "Nenhuma linha corresponde a este filtro"
                  : "Nenhuma linha de log neste recorte"
              }
              descricao={
                filtrando
                  ? "Tente ampliar o período ou limpar os filtros."
                  : "AppLog guarda o que o sistema fez — uma cobrança que falhou, uma mídia que não abriu, um job que morreu. Silêncio aqui significa que nada disso foi registrado, não que a central esteja desligada."
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--p-linha)]">
              {registro.linhas.map((linha) => (
                <li key={linha.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <Selo tom={tomDoNivel(linha.nivel)}>
                      {linha.nivel.toLowerCase()}
                    </Selo>
                    <span className="text-[0.6875rem] tracking-wide text-[var(--p-fraco)] uppercase">
                      {linha.canal}
                    </span>
                    <span className="min-w-0 flex-1 text-[0.8125rem] break-words text-[var(--p-texto)]">
                      {linha.mensagem}
                    </span>
                    <span className="text-[0.75rem] whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDataHora(linha.quando)}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-[var(--p-fraco)]">
                    {linha.correlacao ? (
                      <Link
                        href={`/painel/logs?correlacao=${encodeURIComponent(linha.correlacao)}`}
                        className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[var(--color-rose-300)] hover:underline"
                      >
                        {linha.correlacao}
                      </Link>
                    ) : null}
                    {linha.caminho ? <span>{linha.caminho}</span> : null}
                    {linha.entidade ? <span>{linha.entidade}</span> : null}
                  </div>

                  {linha.pilha ? (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[0.6875rem] text-[var(--p-fraco)] hover:text-[var(--p-suave)]">
                        pilha
                      </summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--p-elevado)] p-2.5 text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-[var(--p-suave)]">
                        {linha.pilha}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Paginacao
            pagina={registro.pagina}
            paginas={registro.paginas}
            total={registro.total}
            rotuloItem="linhas"
          />
        </section>
      </Conteudo>
    </>
  );
}
