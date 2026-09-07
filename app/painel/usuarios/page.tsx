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
  Tabela,
  Td,
  Th,
  Vazio,
} from "@/components/painel/primitivos";
import {
  BarrasRanking,
  GraficoArea,
  Legenda,
  MapaDeCalor,
  CARMIM,
} from "@/components/painel/graficos";
import { IconeUsuarios } from "@/components/painel/icones";
import { rotuloDeDispositivo } from "@/lib/analytics/dispositivo";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  fmtCompacto,
  fmtDataCurta,
  fmtDesde,
  fmtDiaDaChave,
  fmtDuracao,
  fmtNumero,
  fmtPercentual,
} from "@/lib/painel/numeros";
import {
  coortesDeRetencao,
  dispositivos,
  listarUsuarios,
  mapaDeHorarios,
  resumoDeUsuarios,
} from "@/lib/painel/metricas/usuarios";
import { PLANOS } from "@/lib/painel/planos";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Usuários" };

type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDeUsuarios({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("usuarios.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });

  const [resumo, horarios, aparelhos, coortes, lista] = await Promise.all([
    resumoDeUsuarios(periodo),
    mapaDeHorarios(periodo),
    dispositivos(periodo),
    coortesDeRetencao(8),
    listarUsuarios({
      termo: params.q,
      plano: params.plano,
      status: params.status,
      atividade: params.atividade as never,
      ordem: (params.ordem as never) ?? "recentes",
      pagina: Number(params.pagina ?? 1),
      incluirDemo: params.demo === "1",
    }),
  ]);

  return (
    <>
      <Cabecalho
        titulo="Usuários"
        descricao={`${periodo.rotulo} · ${fmtNumero(resumo.totalContas)} contas na plataforma`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        {/* ------------------------------------------------------ recorrência */}
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco
            titulo="Quem esteve por aqui"
            descricao="Pessoas distintas por período — quem entrou conta pela conta, quem não entrou conta pelo aparelho"
            acao={<Legenda itens={[{ nome: "Pessoas", cor: CARMIM }]} />}
          >
            <GraficoArea
              altura={220}
              formato="numero"
              rotuloEixo="Pessoas"
              series={[{ nome: "Pessoas", pontos: resumo.series.ativos }]}
            />
          </Bloco>

          <Bloco titulo="Recorrência" descricao="Estado de hoje">
            <Razao>
              <LinhaRazao rotulo="Ativos no dia" valor={fmtNumero(resumo.dau)} destaque />
              <LinhaRazao rotulo="Ativos na semana" valor={fmtNumero(resumo.wau)} />
              <LinhaRazao rotulo="Ativos no mês" valor={fmtNumero(resumo.mau)} />
              <LinhaRazao
                rotulo="Aderência (dia ÷ mês)"
                valor={
                  resumo.aderencia === null ? "—" : fmtPercentual(resumo.aderencia)
                }
                nota="quanto do público mensal aparece num dia qualquer"
              />
              <LinhaRazao
                rotulo="Inativos há 30 dias"
                valor={fmtNumero(resumo.inativos30d)}
                href="/painel/usuarios?atividade=inativos30d"
              />
            </Razao>
          </Bloco>
        </div>

        {/* ------------------------------------------------- números do período */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Bloco titulo="No período" descricao={periodo.rotulo}>
            <Razao>
              <LinhaRazao
                rotulo="Pessoas alcançadas"
                valor={fmtNumero(resumo.ativos.valor)}
                indicador={resumo.ativos}
                destaque
              />
              <LinhaRazao
                rotulo="Novas contas"
                valor={fmtNumero(resumo.novos.valor)}
                indicador={resumo.novos}
              />
              <LinhaRazao
                rotulo="Quem já conhecia"
                valor={fmtNumero(resumo.recorrentes.valor)}
                indicador={resumo.recorrentes}
                nota="pessoas ativas que não são novas no período"
              />
              <LinhaRazao
                rotulo="Sessões por pessoa"
                valor={resumo.sessoesPorPessoa.valor.toFixed(1).replace(".", ",")}
                indicador={resumo.sessoesPorPessoa}
              />
              <LinhaRazao
                rotulo="Duração média da sessão"
                valor={fmtDuracao(resumo.duracaoMediaSessaoMs.valor)}
                indicador={resumo.duracaoMediaSessaoMs}
              />
              <LinhaRazao
                rotulo="Tempo total na plataforma"
                valor={fmtDuracao(resumo.tempoNaPlataformaMs.valor)}
                indicador={resumo.tempoNaPlataformaMs}
              />
              <LinhaRazao
                rotulo="Tempo assistido"
                valor={fmtDuracao(resumo.tempoAssistidoMs.valor)}
                indicador={resumo.tempoAssistidoMs}
              />
            </Razao>
          </Bloco>

          <Bloco
            titulo="Aparelhos"
            descricao="Por sessões no período"
            compacto
          >
            {aparelhos.length === 0 ? (
              <Vazio
                titulo="Nenhuma sessão no período"
                descricao="A leitura de aparelho vem do navegador e, quando ele não responde, do User-Agent no servidor."
              />
            ) : (
              <BarrasRanking
                formato="numero"
                itens={aparelhos.slice(0, 8).map((linha, i) => ({
                  chave: `${linha.osName}-${linha.browser}-${linha.platform}-${i}`,
                  rotulo: `${rotuloDeDispositivo(linha.osName, linha.browser)}${
                    linha.platform === "pwa" ? " · instalado" : ""
                  }`,
                  valor: linha.sessoes,
                  nota: `${linha.pessoas} ${linha.pessoas === 1 ? "pessoa" : "pessoas"}`,
                }))}
              />
            )}
          </Bloco>
        </div>

        {/* ----------------------------------------------------- horário de pico */}
        <Bloco
          titulo="Quando as pessoas aparecem"
          descricao="Sessões por dia da semana e hora, no horário de Brasília"
        >
          <MapaDeCalor celulas={horarios} formato="numero" />
        </Bloco>

        {/* ---------------------------------------------------------- retenção */}
        <Bloco
          titulo="Retenção por coorte"
          descricao="De cada grupo que se cadastrou numa semana, quantos voltaram nas semanas seguintes"
        >
          {coortes.length === 0 ? (
            <Vazio
              titulo="Ainda não há coortes"
              descricao="A tabela precisa de pelo menos duas semanas de cadastros para dizer alguma coisa sobre retorno."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Semana</Th>
                  <Th alinhar="direita">Pessoas</Th>
                  {Array.from({ length: 6 }, (_, i) => (
                    <Th key={i} alinhar="direita">
                      {i === 0 ? "Sem. 0" : `+${i}`}
                    </Th>
                  ))}
                </tr>
              }
            >
              {coortes.map((coorte) => (
                <tr key={coorte.semana} className="painel-linha">
                  <Td className="whitespace-nowrap">
                    {fmtDiaDaChave(coorte.semana)}
                  </Td>
                  <Td alinhar="direita" className="font-medium">
                    {coorte.tamanho}
                  </Td>
                  {Array.from({ length: 6 }, (_, i) => {
                    const pessoas = coorte.retorno[i] ?? 0;
                    const fracao = coorte.tamanho > 0 ? pessoas / coorte.tamanho : 0;
                    return (
                      <Td key={i} alinhar="direita">
                        {pessoas === 0 ? (
                          <span className="text-[var(--p-fraco)]">—</span>
                        ) : (
                          <span
                            className="tabular inline-block rounded px-1.5 py-0.5"
                            style={{
                              background: `color-mix(in oklab, ${CARMIM} ${Math.round(fracao * 70)}%, transparent)`,
                            }}
                          >
                            {fmtPercentual(fracao, 0)}
                          </span>
                        )}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </Tabela>
          )}
        </Bloco>

        {/* ----------------------------------------------------------- listagem */}
        <section className="painel-cartao overflow-hidden">
          <BarraDeFiltros>
            <CampoDeBusca placeholder="Nome, e-mail, @ ou ID…" />
            <Seletor
              chave="plano"
              rotulo="Plano"
              opcoes={[
                { valor: "", rotulo: "Todos os planos" },
                ...Object.values(PLANOS).map((p) => ({
                  valor: p.plano,
                  rotulo: p.nome,
                })),
              ]}
            />
            <Seletor
              chave="atividade"
              rotulo="Atividade"
              opcoes={[
                { valor: "", rotulo: "Qualquer atividade" },
                { valor: "ativos7d", rotulo: "Ativos em 7 dias" },
                { valor: "ativos30d", rotulo: "Ativos em 30 dias" },
                { valor: "inativos30d", rotulo: "Parados há 30 dias" },
                { valor: "nunca", rotulo: "Nunca acessaram" },
              ]}
            />
            <Seletor
              chave="status"
              rotulo="Situação"
              opcoes={[
                { valor: "", rotulo: "Qualquer situação" },
                { valor: "ACTIVE", rotulo: "Ativa" },
                { valor: "SUSPENDED", rotulo: "Suspensa" },
              ]}
            />
            <Seletor
              chave="ordem"
              rotulo="Ordenar"
              padrao="recentes"
              opcoes={[
                { valor: "recentes", rotulo: "Mais recentes" },
                { valor: "ativos", rotulo: "Último acesso" },
                { valor: "assistido", rotulo: "Mais assistiram" },
                { valor: "nome", rotulo: "Nome" },
              ]}
            />
            <Alternador chave="demo" rotulo="Incluir demonstração" />
          </BarraDeFiltros>

          {lista.linhas.length === 0 ? (
            <Vazio
              icone={<IconeUsuarios tamanho={28} />}
              titulo="Nenhuma conta com esses filtros"
              descricao="Ajuste a busca ou limpe os filtros. Contas de demonstração ficam escondidas por padrão — o interruptor acima as traz de volta."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Pessoa</Th>
                  <Th>Plano</Th>
                  <Th alinhar="direita">Sessões</Th>
                  <Th alinhar="direita">Na plataforma</Th>
                  <Th alinhar="direita">Assistido</Th>
                  <Th alinhar="direita">Episódios</Th>
                  <Th alinhar="direita">Último acesso</Th>
                  <Th alinhar="direita">Entrou</Th>
                </tr>
              }
            >
              {lista.linhas.map((linha) => (
                <tr key={linha.id} className="painel-linha">
                  <Td>
                    <Link
                      href={`/painel/usuarios/${linha.id}`}
                      className="block max-w-[16rem]"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium hover:text-[var(--color-rose-300)]">
                          {linha.nome}
                        </span>
                        {linha.isDemo ? <Selo>demonstração</Selo> : null}
                        {linha.papel !== "USER" ? (
                          <Selo tom="acento">
                            {linha.papel === "ADMIN" ? "admin" : "editor"}
                          </Selo>
                        ) : null}
                        {linha.status === "SUSPENDED" ? (
                          <Selo tom="perigo">suspensa</Selo>
                        ) : null}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                        {linha.email}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    {linha.plano ? (
                      <Selo
                        tom={
                          linha.plano === "FREE"
                            ? "neutro"
                            : linha.statusAssinatura === "ACTIVE" ||
                                linha.statusAssinatura === "TRIALING"
                              ? "bom"
                              : "atencao"
                        }
                      >
                        {PLANOS[linha.plano as keyof typeof PLANOS]?.nome ??
                          linha.plano}
                      </Selo>
                    ) : (
                      <span className="text-[var(--p-fraco)]">—</span>
                    )}
                  </Td>
                  <Td alinhar="direita">{fmtCompacto(linha.sessoes)}</Td>
                  <Td alinhar="direita">
                    {fmtDuracao(linha.tempoNaPlataformaMs)}
                  </Td>
                  <Td alinhar="direita">{fmtDuracao(linha.tempoAssistidoMs)}</Td>
                  <Td alinhar="direita">
                    <span className="tabular">
                      {linha.episodiosConcluidos}
                      <span className="text-[var(--p-fraco)]">
                        /{linha.episodiosIniciados}
                      </span>
                    </span>
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-suave)]">
                    {fmtDesde(linha.ultimoAcesso)}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-fraco)]">
                    {fmtDataCurta(linha.criadoEm)}
                  </Td>
                </tr>
              ))}
            </Tabela>
          )}

          <Paginacao
            pagina={lista.pagina}
            paginas={lista.paginas}
            total={lista.total}
            rotuloItem="contas"
          />
        </section>
      </Conteudo>
    </>
  );
}
