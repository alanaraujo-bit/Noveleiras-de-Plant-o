import Link from "next/link";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  Bloco,
  LinhaRazao,
  NotaDeCobertura,
  Razao,
  Selo,
  Tabela,
  Td,
  Th,
  Variacao,
  Vazio,
} from "@/components/painel/primitivos";
import {
  BarrasRanking,
  GraficoArea,
  Legenda,
  CARMIM,
  NEUTRO,
} from "@/components/painel/graficos";
import {
  IconeAlertas,
  IconeOk,
  IconeSetaDireita,
} from "@/components/painel/icones";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  fmtCompacto,
  fmtDesde,
  fmtDuracao,
  fmtMoeda,
  fmtNumero,
  fmtPercentual,
  indicador,
} from "@/lib/painel/numeros";
import {
  conteudoMaisAssistido,
  crescimentoDeConteudo,
  resumoDaVisao,
} from "@/lib/painel/metricas/visao";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Visão geral" };

type Busca = Promise<{ periodo?: string; de?: string; ate?: string }>;

export default async function VisaoGeral({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("visao.ver");

  const { periodo: chave, de, ate } = await searchParams;
  const periodo = resolverPeriodo(chave, { de, ate });

  const [resumo, conteudo, crescimento, alertas, falhasRecentes] =
    await Promise.all([
      resumoDaVisao(periodo),
      conteudoMaisAssistido(periodo, 6),
      crescimentoDeConteudo(periodo, 5),
      db.alert.findMany({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
        take: 5,
      }),
      db.appLog.findMany({
        where: {
          level: { in: ["ERROR", "FATAL"] },
          createdAt: { gte: periodo.inicio, lt: periodo.fim },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  const { agora } = resumo;

  return (
    <>
      <Cabecalho
        titulo="Central de operações"
        descricao={
          <span>
            {periodo.rotulo} · comparado com o período anterior de mesma duração
          </span>
        }
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        {/* ---------------------------------------------------------- agora

            Fica separado do resto e antes de tudo: "agora" não obedece ao
            seletor de período, e misturar as duas leituras na mesma faixa
            faria alguém ler o presente como se fosse o recorte escolhido. */}
        <section className="painel-cartao flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span
                className={`painel-pulso absolute inline-flex h-full w-full rounded-full ${
                  agora.online > 0
                    ? "bg-[var(--p-bom)]"
                    : "bg-[var(--p-fraco)]"
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  agora.online > 0 ? "bg-[var(--p-bom)]" : "bg-[var(--p-fraco)]"
                }`}
              />
            </span>
            <span className="text-[0.75rem] font-medium text-[var(--p-suave)]">
              Agora
            </span>
          </div>

          <NumeroAoVivo
            valor={agora.online}
            rotulo="pessoas na plataforma"
            destaque
          />
          <NumeroAoVivo valor={agora.assistindo} rotulo="assistindo" />
          <NumeroAoVivo valor={agora.sessoesAbertas} rotulo="sessões abertas" />
          <NumeroAoVivo
            valor={agora.instaladas}
            rotulo="pelo app instalado"
          />

          <p className="ml-auto max-w-[15rem] text-[0.6875rem] leading-snug text-[var(--p-fraco)]">
            Presença medida por batimento de sessão nos últimos 5 minutos.
          </p>
        </section>

        {/* ------------------------------------------- atividade + livro-razão */}
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          {/* Dois gráficos empilhados, não um esticado: o bloco vizinho é a
              lista de indicadores, sempre mais alta que um gráfico só, e deixar
              a grade esticar transformaria a Atividade numa caixa quase vazia. */}
          <div className="space-y-5">
            <Bloco
              titulo="Atividade"
              descricao="Sessões abertas ao longo do período"
              acao={
                <Legenda
                  itens={[
                    { nome: periodo.rotulo, cor: CARMIM },
                    { nome: "Período anterior", cor: NEUTRO, tracejado: true },
                  ]}
                />
              }
            >
              <GraficoArea
                altura={230}
                rotuloEixo="Sessões"
                formato="compacto"
                series={[
                  { nome: periodo.rotulo, pontos: resumo.series.sessoes },
                  {
                    nome: "Período anterior",
                    pontos: resumo.series.sessoesAnterior,
                    fantasma: true,
                  },
                ]}
              />
            </Bloco>

            <Bloco
              titulo="Reproduções"
              descricao="Quantas vezes alguém deu play"
              acao={
                <Legenda
                  itens={[
                    { nome: periodo.rotulo, cor: CARMIM },
                    { nome: "Período anterior", cor: NEUTRO, tracejado: true },
                  ]}
                />
              }
            >
              <GraficoArea
                altura={200}
                rotuloEixo="Reproduções"
                formato="compacto"
                vazio="Ninguém deu play neste recorte"
                series={[
                  { nome: periodo.rotulo, pontos: resumo.series.reproducoes },
                  {
                    nome: "Período anterior",
                    pontos: resumo.series.reproducoesAnterior,
                    fantasma: true,
                  },
                ]}
              />
            </Bloco>
          </div>

          <Bloco titulo="No período" descricao={periodo.rotulo}>
            <Razao>
              <LinhaRazao
                rotulo="Pessoas alcançadas"
                valor={fmtNumero(resumo.espectadores.valor)}
                indicador={resumo.espectadores}
                destaque
              />
              <LinhaRazao
                rotulo="Sessões"
                valor={fmtNumero(resumo.sessoes.valor)}
                indicador={resumo.sessoes}
              />
              <LinhaRazao
                rotulo="Novos usuários"
                valor={fmtNumero(resumo.novosUsuarios.valor)}
                indicador={resumo.novosUsuarios}
                href="/painel/usuarios"
              />
              <LinhaRazao
                rotulo="Reproduções"
                valor={fmtNumero(resumo.reproducoes.valor)}
                indicador={resumo.reproducoes}
                href="/painel/streaming"
              />
              <LinhaRazao
                rotulo="Tempo assistido"
                valor={fmtDuracao(resumo.tempoAssistidoMs.valor)}
                indicador={resumo.tempoAssistidoMs}
                nota={
                  resumo.coberturaTempoAssistido.parcial
                    ? "medição parcial no recorte"
                    : undefined
                }
              />
              <LinhaRazao
                rotulo="Tempo na plataforma"
                valor={fmtDuracao(resumo.tempoNaPlataformaMs.valor)}
                indicador={resumo.tempoNaPlataformaMs}
              />
              <LinhaRazao
                rotulo="Novos assinantes"
                valor={fmtNumero(resumo.novosAssinantes.valor)}
                indicador={resumo.novosAssinantes}
                href="/painel/financeiro"
              />
              <LinhaRazao
                rotulo="Cancelamentos"
                valor={fmtNumero(resumo.cancelamentos.valor)}
                indicador={resumo.cancelamentos}
                sentido="menor-melhor"
              />
              <LinhaRazao
                rotulo="Receita"
                valor={fmtMoeda(resumo.receitaCents.valor)}
                indicador={resumo.receitaCents}
                href="/painel/financeiro"
              />
              <LinhaRazao
                rotulo="Falhas registradas"
                valor={fmtNumero(resumo.falhas.valor)}
                indicador={resumo.falhas}
                sentido="menor-melhor"
                href="/painel/logs?nivel=ERROR"
              />
            </Razao>
          </Bloco>
        </div>

        {/* --------------------------------------------------- estado do negócio */}
        <div className="grid gap-5 lg:grid-cols-3">
          <Bloco titulo="Assinatura" descricao="Estado atual, não do período">
            <Razao>
              <LinhaRazao
                rotulo="Assinantes ativos"
                valor={fmtNumero(resumo.assinantesAtivos)}
                destaque
              />
              <LinhaRazao
                rotulo="Receita recorrente mensal"
                valor={fmtMoeda(resumo.mrr.cents)}
                nota={
                  resumo.mrr.estimadas > 0 ? (
                    <span className="text-[var(--p-atencao)]">
                      {resumo.mrr.estimadas} de {resumo.assinantesAtivos} sem
                      preço registrado — valor de tabela do plano
                    </span>
                  ) : undefined
                }
              />
              <LinhaRazao
                rotulo="Churn no período"
                valor={
                  resumo.churn.taxa === null
                    ? "—"
                    : fmtPercentual(resumo.churn.taxa)
                }
                nota={
                  resumo.churn.baseInicial === 0
                    ? "sem base de assinantes no início do período"
                    : `${resumo.churn.cancelados} de ${resumo.churn.baseInicial}`
                }
              />
              <LinhaRazao
                rotulo="Contas na plataforma"
                valor={fmtNumero(resumo.usuariosTotais)}
                href="/painel/usuarios"
              />
            </Razao>
          </Bloco>

          <Bloco
            titulo="Tempo assistido"
            descricao="Somado por período"
            className="lg:col-span-2"
          >
            <GraficoArea
              altura={170}
              formato="duracao"
              vazio="Nenhum tempo de reprodução registrado neste recorte"
              series={[
                {
                  nome: "Tempo assistido",
                  pontos: resumo.series.tempoAssistidoMs,
                },
              ]}
            />
            <div className="mt-3">
              <NotaDeCobertura
                desde={resumo.coberturaTempoAssistido.desde}
                oQue="Tempo assistido"
              />
            </div>
          </Bloco>
        </div>

        {/* ------------------------------------------------------------ conteúdo */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Mais assistido"
            descricao="Por reproduções no período"
            acao={
              <Link
                href="/painel/streaming"
                className="inline-flex items-center gap-1 text-[0.75rem] text-[var(--p-fraco)] hover:text-[var(--p-suave)]"
              >
                Ver tudo <IconeSetaDireita tamanho={13} />
              </Link>
            }
            compacto
          >
            {conteudo.length === 0 ? (
              <Vazio
                titulo="Nenhuma reprodução no período"
                descricao="Assim que alguém der play, a novela aparece aqui com reproduções, espectadores e tempo assistido."
              />
            ) : (
              <BarrasRanking
                itens={conteudo.map((linha) => ({
                  chave: linha.novelaId,
                  rotulo: linha.titulo,
                  valor: linha.reproducoes,
                  nota: `${linha.espectadores} ${
                    linha.espectadores === 1 ? "pessoa" : "pessoas"
                  }`,
                }))}
                formato="numero"
              />
            )}
          </Bloco>

          <Bloco
            titulo="O que mudou"
            descricao="Maior movimento contra o período anterior"
            compacto
          >
            {crescimento.length === 0 ? (
              <Vazio
                titulo="Nada se moveu ainda"
                descricao="Esta lista compara as reproduções de cada novela com o período anterior. Ela ganha sentido a partir do segundo período com uso."
              />
            ) : (
              <Tabela
                cabecalho={
                  <tr>
                    <Th>Novela</Th>
                    <Th alinhar="direita">Antes</Th>
                    <Th alinhar="direita">Agora</Th>
                    <Th alinhar="direita">Variação</Th>
                  </tr>
                }
              >
                {crescimento.map((linha) => (
                  <tr key={linha.novelaId} className="painel-linha">
                    <Td className="max-w-[12rem] truncate">
                      <Link
                        href={`/painel/streaming/${linha.slug}`}
                        className="hover:text-[var(--color-rose-300)]"
                      >
                        {linha.titulo}
                      </Link>
                    </Td>
                    <Td alinhar="direita" className="text-[var(--p-fraco)]">
                      {fmtNumero(linha.anterior)}
                    </Td>
                    <Td alinhar="direita" className="font-medium">
                      {fmtNumero(linha.reproducoes)}
                    </Td>
                    <Td alinhar="direita">
                      <Variacao
                        miudo
                        indicador={indicador(linha.reproducoes, linha.anterior)}
                      />
                    </Td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Bloco>
        </div>

        {/* -------------------------------------------------- o que exige atenção */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Exige atenção"
            descricao="Alertas abertos"
            acao={
              <Link
                href="/painel/alertas"
                className="inline-flex items-center gap-1 text-[0.75rem] text-[var(--p-fraco)] hover:text-[var(--p-suave)]"
              >
                Ver todos <IconeSetaDireita tamanho={13} />
              </Link>
            }
            compacto
          >
            {alertas.length === 0 ? (
              <Vazio
                icone={<IconeOk tamanho={28} />}
                titulo="Nada exigindo atenção"
                descricao="Alertas aparecem aqui quando o servidor cai, o disco aperta, a mídia some ou as falhas passam do normal."
              />
            ) : (
              <ul className="divide-y divide-[var(--p-linha)]">
                {alertas.map((alerta) => (
                  <li key={alerta.id} className="flex items-start gap-3 py-2.5">
                    <Selo
                      tom={
                        alerta.severity === "CRITICAL"
                          ? "perigo"
                          : alerta.severity === "WARNING"
                            ? "atencao"
                            : "info"
                      }
                      icone={<IconeAlertas tamanho={11} />}
                    >
                      {alerta.severity === "CRITICAL"
                        ? "Crítico"
                        : alerta.severity === "WARNING"
                          ? "Atenção"
                          : "Aviso"}
                    </Selo>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8125rem] text-[var(--p-texto)]">
                        {alerta.title}
                      </p>
                      <p className="text-[0.6875rem] text-[var(--p-fraco)]">
                        {fmtDesde(alerta.lastSeenAt)}
                        {alerta.occurrences > 1
                          ? ` · ${alerta.occurrences} ocorrências`
                          : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          <Bloco
            titulo="Falhas recentes"
            descricao="Erros registrados no período"
            acao={
              <Link
                href="/painel/logs?nivel=ERROR"
                className="inline-flex items-center gap-1 text-[0.75rem] text-[var(--p-fraco)] hover:text-[var(--p-suave)]"
              >
                Investigar <IconeSetaDireita tamanho={13} />
              </Link>
            }
            compacto
          >
            {falhasRecentes.length === 0 ? (
              <Vazio
                icone={<IconeOk tamanho={28} />}
                titulo="Nenhuma falha no período"
                descricao="Erros de aplicação, mídia, pagamento e jobs caem aqui com o identificador que costura a investigação."
              />
            ) : (
              <ul className="divide-y divide-[var(--p-linha)]">
                {falhasRecentes.map((linha) => (
                  <li key={linha.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <Selo tom="perigo">{linha.channel}</Selo>
                      <span className="tabular text-[0.6875rem] text-[var(--p-fraco)]">
                        {fmtDesde(linha.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[0.8125rem] text-[var(--p-texto)]">
                      {linha.message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>
      </Conteudo>
    </>
  );
}

function NumeroAoVivo({
  valor,
  rotulo,
  destaque,
}: {
  valor: number;
  rotulo: string;
  destaque?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={`numero font-semibold ${
          destaque
            ? "text-[1.75rem] text-[var(--p-texto)]"
            : "text-[1.125rem] text-[var(--p-suave)]"
        }`}
      >
        {fmtNumero(valor)}
      </span>
      <span className="text-[0.75rem] text-[var(--p-fraco)]">{rotulo}</span>
    </div>
  );
}
