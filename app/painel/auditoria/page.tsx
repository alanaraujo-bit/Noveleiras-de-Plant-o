import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
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
import { BarrasRanking, CARMIM, GraficoArea } from "@/components/painel/graficos";
import { IconeAuditoria } from "@/components/painel/icones";
import { Diferenca, SeloDeSeveridade } from "@/components/painel/Auditoria";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  listarAuditoria,
  resumoDaAuditoria,
} from "@/lib/painel/metricas/auditoria";
import { fmtDataHora, fmtDesde, fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Auditoria" };

type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDeAuditoria({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("auditoria.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });

  const [resumo, registro] = await Promise.all([
    resumoDaAuditoria(periodo),
    listarAuditoria({
      periodo,
      termo: params.q,
      acao: params.acao,
      severidade: params.severidade,
      atorId: params.ator,
      alvoId: params.alvo,
      pagina: Number(params.pagina ?? 1),
    }),
  ]);

  const filtrando = Boolean(
    params.q || params.acao || params.severidade || params.ator || params.alvo,
  );

  return (
    <>
      <Cabecalho
        titulo="Auditoria"
        descricao={`${periodo.rotulo} · ${fmtNumero(resumo.acoes)} ${resumo.acoes === 1 ? "ação registrada" : "ações registradas"}`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco
            titulo="O que a equipe fez"
            descricao="Ações administrativas registradas ao longo do recorte"
          >
            <GraficoArea
              altura={220}
              formato="numero"
              rotuloEixo="Ações"
              vazio="Nenhuma ação administrativa neste recorte"
              series={[{ nome: "Ações", pontos: resumo.serie, cor: CARMIM }]}
            />
          </Bloco>

          <Bloco titulo="Natureza das ações" descricao={periodo.rotulo}>
            <Razao>
              <LinhaRazao
                rotulo="Ações"
                valor={fmtNumero(resumo.acoes)}
                destaque
              />
              <LinhaRazao
                rotulo="Pessoas agindo"
                valor={fmtNumero(resumo.atores)}
                nota="administradores distintos no período"
              />
              <LinhaRazao
                rotulo="Ações delicadas"
                valor={fmtNumero(resumo.destrutivas)}
                sentido="neutro"
                nota="suspensões, ocultações e afins"
              />
              <LinhaRazao
                rotulo="Ações críticas"
                valor={fmtNumero(resumo.criticas)}
                sentido="neutro"
                nota="mudanças de acesso ao próprio painel"
              />
              <LinhaRazao
                rotulo="Última ação"
                valor={
                  resumo.ultimaAcao ? fmtDesde(resumo.ultimaAcao) : "nenhuma"
                }
                nota={
                  resumo.ultimaAcao ? fmtDataHora(resumo.ultimaAcao) : undefined
                }
              />
            </Razao>
            <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
              {resumo.primeiraAcao
                ? `A trilha começa em ${fmtDataHora(resumo.primeiraAcao)}. Nada aqui é editável: uma trilha que o administrador pode corrigir não audita administrador nenhum.`
                : "A trilha ainda não tem nenhuma linha. Ela é preenchida por ações do painel — nada aqui é escrito à mão, e nada é editável depois."}
            </p>
          </Bloco>
        </div>

        {resumo.porAcao.length > 0 ? (
          <Bloco
            titulo="Verbos mais usados"
            descricao="O que a operação mais faz, por tipo de ação"
          >
            <BarrasRanking
              formato="numero"
              itens={resumo.porAcao.map((linha) => ({
                chave: linha.acao,
                rotulo: linha.acao,
                valor: linha.total,
              }))}
            />
          </Bloco>
        ) : null}

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Registro
            </h2>
            <p className="mt-0.5 max-w-[74ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
              Cada linha guarda o estado antes e depois. Saber que alguém
              “editou a conta” não ajuda; saber o que mudou, quando e a partir
              de qual valor, ajuda.
            </p>
          </header>
          <BarraDeFiltros>
            <CampoDeBusca placeholder="Buscar autor, alvo ou verbo…" />
            <Seletor
              chave="severidade"
              rotulo="Filtrar por severidade"
              opcoes={[
                { valor: "", rotulo: "Toda severidade" },
                { valor: "INFO", rotulo: "Rotina" },
                { valor: "WARNING", rotulo: "Delicada" },
                { valor: "CRITICAL", rotulo: "Crítica" },
              ]}
            />
            {registro.acoesDisponiveis.length > 0 ? (
              <Seletor
                chave="acao"
                rotulo="Filtrar por ação"
                opcoes={[
                  { valor: "", rotulo: "Toda ação" },
                  ...registro.acoesDisponiveis.map((acao) => ({
                    valor: acao,
                    rotulo: acao,
                  })),
                ]}
              />
            ) : null}
          </BarraDeFiltros>

          {registro.linhas.length === 0 ? (
            <Vazio
              icone={<IconeAuditoria tamanho={28} />}
              titulo={
                filtrando
                  ? "Nenhuma ação corresponde a este filtro"
                  : "Nenhuma ação administrativa neste recorte"
              }
              descricao={
                filtrando
                  ? "Tente ampliar o período ou limpar os filtros."
                  : "A trilha é escrita pelas ações do painel: suspender uma conta, ocultar uma publicação, conceder acesso. Enquanto ninguém agir, ela fica vazia — e vazia aqui significa que nada foi feito, não que algo se perdeu."
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--p-linha)]">
              {registro.linhas.map((linha) => (
                <li key={linha.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <SeloDeSeveridade severidade={linha.severidade} />
                    <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">
                      {linha.acao}
                    </code>
                    <span className="text-[0.8125rem] text-[var(--p-suave)]">
                      {linha.ator.nome}
                    </span>
                    <span className="text-[0.6875rem] text-[var(--p-fraco)]">
                      {linha.ator.email}
                    </span>
                    <span className="ml-auto text-[0.75rem] whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDataHora(linha.quando)}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[0.8125rem] text-[var(--p-texto)]">
                    <span className="text-[var(--p-fraco)]">
                      {linha.tipoDoAlvo}
                    </span>{" "}
                    {linha.alvoRotulo ?? linha.alvoId ?? "—"}
                  </p>

                  <Diferenca antes={linha.antes} depois={linha.depois} />

                  {linha.ip ? (
                    <p className="mt-2 text-[0.6875rem] text-[var(--p-fraco)]">
                      origem {linha.ip}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Paginacao
            pagina={registro.pagina}
            paginas={registro.paginas}
            total={registro.total}
            rotuloItem="ações"
          />
        </section>
      </Conteudo>
    </>
  );
}
