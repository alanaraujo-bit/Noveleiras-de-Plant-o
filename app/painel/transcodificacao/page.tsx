import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import { BarraDeFiltros, Seletor } from "@/components/painel/Filtros";
import {
  AguardandoInstrumentacao,
  NadaAconteceu,
} from "@/components/painel/Instrumentacao";
import { AcoesDoTrabalho } from "@/components/painel/InfraAcoes";
import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
} from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  instrumentacaoDaInfraestrutura,
  listarTrabalhos,
  resumoDaFila,
} from "@/lib/painel/metricas/infraestrutura";
import {
  fmtDataHora,
  fmtDesde,
  fmtDuracao,
  fmtNumero,
} from "@/lib/painel/numeros";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Transcodificação" };

type Busca = Promise<Record<string, string | undefined>>;

const ROTULO_DE_ESTADO: Record<string, string> = {
  QUEUED: "na fila",
  RUNNING: "rodando",
  DONE: "concluído",
  FAILED: "falhou",
  CANCELED: "cancelado",
};

function tomDoEstado(estado: string) {
  if (estado === "DONE") return "bom" as const;
  if (estado === "FAILED") return "perigo" as const;
  if (estado === "RUNNING") return "info" as const;
  if (estado === "QUEUED") return "atencao" as const;
  return "neutro" as const;
}

export default async function PaginaDeTranscodificacao({
  searchParams,
}: {
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("transcode.ver");
  const podeGerenciar = operador.pode("transcode.gerenciar");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });

  const [resumo, trabalhos, instrumentacao] = await Promise.all([
    resumoDaFila(periodo),
    listarTrabalhos({ situacao: params.situacao }),
    instrumentacaoDaInfraestrutura(),
  ]);

  return (
    <>
      <Cabecalho
        titulo="Transcodificação"
        descricao={
          resumo.total === 0
            ? "Fila vazia — nenhum trabalho pedido até agora"
            : `${fmtNumero(resumo.naFila)} na fila · ${fmtNumero(resumo.rodando)} rodando · ${fmtNumero(resumo.falhados)} com falha`
        }
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        {resumo.total === 0 && !instrumentacao.ligada ? (
          <AguardandoInstrumentacao
            oQue="Fila, progresso e falhas de preparação de vídeo"
            tabela="TranscodeJob"
            comoLigar={
              <>
                Um trabalho é enfileirado quando um vídeo novo precisa virar as
                versões que o player consome — 1080p, 720p, HLS. Quem enfileira
                é a ingestão de mídia; quem executa é o agente no servidor, que
                reporta progresso, velocidade e ETA de volta.
                <br />
                <br />
                Nenhuma das duas pontas existe ainda: sem servidor registrado e
                sem inventário de arquivos, não há o que preparar. Registre o
                servidor e rode o inventário — esta tela e a de Mídia se ligam
                pelo mesmo agente.
              </>
            }
            oQueVaiMostrar={[
              "A fila na ordem real de execução: o que roda agora, depois prioridade, depois quem chegou antes.",
              "Progresso ao vivo com velocidade em relação ao tempo real e ETA.",
              "Se o trabalho usou GPU, e quantas tentativas já foram feitas.",
              "A mensagem de erro de cada falha, copiável, para reenfileirar com conhecimento de causa.",
            ]}
          />
        ) : resumo.total === 0 ? (
          <NadaAconteceu
            titulo="A fila está vazia"
            porQue="Nenhum trabalho foi enfileirado. Isso não é falha: transcodificar é sob demanda, e ninguém pediu ainda."
            proximoPasso={
              <>
                Abra <strong>Mídia</strong>, filtre os arquivos que quer preparar
                e escolha um perfil de saída. Na máquina que guarda os vídeos,
                deixe o executor rodando com{" "}
                <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">
                  npm run agente:transcode
                </code>
                .
              </>
            }
            fonte={`instrumentação viva · ${fmtNumero(instrumentacao.arquivos)} arquivos catalogados · ${instrumentacao.servidoresQueBateram === 1 ? "1 servidor reportando" : `${instrumentacao.servidoresQueBateram} servidores reportando`}`}
          />
        ) : (
          <>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Bloco titulo="A fila agora" descricao="Estado dos trabalhos">
                <Razao>
                  <LinhaRazao
                    rotulo="Rodando"
                    valor={fmtNumero(resumo.rodando)}
                    destaque
                  />
                  <LinhaRazao rotulo="Na fila" valor={fmtNumero(resumo.naFila)} />
                  <LinhaRazao
                    rotulo="Com falha"
                    valor={fmtNumero(resumo.falhados)}
                    sentido="menor-melhor"
                  />
                  <LinhaRazao
                    rotulo="Cancelados"
                    valor={fmtNumero(resumo.cancelados)}
                    sentido="neutro"
                  />
                </Razao>
              </Bloco>

              <Bloco titulo="No período" descricao={periodo.rotulo}>
                <Razao>
                  <LinhaRazao
                    rotulo="Concluídos"
                    valor={fmtNumero(resumo.concluidosNoPeriodo)}
                    destaque
                  />
                  <LinhaRazao
                    rotulo="Falharam"
                    valor={fmtNumero(resumo.falhadosNoPeriodo)}
                    sentido="menor-melhor"
                  />
                  <LinhaRazao
                    rotulo="Tempo médio"
                    valor={
                      resumo.tempoMedioMs === null
                        ? "—"
                        : fmtDuracao(resumo.tempoMedioMs)
                    }
                    nota="do início ao fim, só de trabalhos concluídos"
                  />
                </Razao>
              </Bloco>
            </div>

            <section className="painel-cartao overflow-hidden">
              <header className="border-b border-[var(--p-linha)] px-5 py-4">
                <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                  Trabalhos
                </h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                  Na ordem real de execução, não por data de entrada
                </p>
              </header>
              <BarraDeFiltros>
                <Seletor
                  chave="situacao"
                  rotulo="Filtrar por situação"
                  opcoes={[
                    { valor: "", rotulo: "Toda situação" },
                    ...Object.entries(ROTULO_DE_ESTADO).map(([valor, rotulo]) => ({
                      valor,
                      rotulo,
                    })),
                  ]}
                />
              </BarraDeFiltros>
              <ul className="divide-y divide-[var(--p-linha)]">
                {trabalhos.map((trabalho) => (
                  <li key={trabalho.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <Selo tom={tomDoEstado(trabalho.situacao)}>
                        {ROTULO_DE_ESTADO[trabalho.situacao] ?? trabalho.situacao}
                      </Selo>
                      <span className="text-[0.8125rem] text-[var(--p-texto)]">
                        {trabalho.perfil}
                      </span>
                      {trabalho.usouGpu ? <Selo tom="info">GPU</Selo> : null}
                      <span className="min-w-0 flex-1 truncate text-[0.75rem] text-[var(--p-fraco)]">
                        {trabalho.entradaKey ?? trabalho.episodioId ?? ""}
                      </span>
                      <span className="text-[0.75rem] whitespace-nowrap text-[var(--p-fraco)]">
                        {trabalho.terminadoEm
                          ? fmtDataHora(trabalho.terminadoEm)
                          : fmtDesde(trabalho.enfileiradoEm)}
                      </span>
                      <AcoesDoTrabalho
                        jobId={trabalho.id}
                        situacao={trabalho.situacao}
                        podeGerenciar={podeGerenciar}
                      />
                    </div>

                    {trabalho.situacao === "RUNNING" ? (
                      <div className="mt-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--p-elevado)]">
                          <div
                            className="h-full rounded-full bg-[var(--p-acento)] transition-[width]"
                            style={{ width: `${trabalho.progresso}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[0.6875rem] text-[var(--p-fraco)]">
                          {Math.round(trabalho.progresso)}%
                          {trabalho.velocidade
                            ? ` · ${trabalho.velocidade.toFixed(1)}× tempo real`
                            : ""}
                          {trabalho.etaSec
                            ? ` · faltam ${fmtDuracao(trabalho.etaSec * 1000)}`
                            : ""}
                        </p>
                      </div>
                    ) : null}

                    {trabalho.erro ? (
                      <p className="mt-1.5 rounded bg-[var(--p-elevado)] px-2 py-1.5 text-[0.6875rem] leading-relaxed break-words text-[var(--p-suave)]">
                        {trabalho.erro}
                        {trabalho.tentativas > 1
                          ? ` · ${trabalho.tentativas} tentativas`
                          : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </Conteudo>
    </>
  );
}
