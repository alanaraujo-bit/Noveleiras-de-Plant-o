import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import { Seletor, BarraDeFiltros } from "@/components/painel/Filtros";
import { AguardandoInstrumentacao } from "@/components/painel/Instrumentacao";
import { AcoesDoAlerta, ReavaliarAgora } from "@/components/painel/InfraAcoes";
import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
} from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  listarAlertas,
  resumoDeAlertas,
} from "@/lib/painel/metricas/infraestrutura";
import { fmtDataHora, fmtDesde, fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Alertas" };

type Busca = Promise<Record<string, string | undefined>>;

const ROTULO_DE_SITUACAO: Record<string, string> = {
  OPEN: "aberto",
  ACKNOWLEDGED: "reconhecido",
  RESOLVED: "resolvido",
};

export default async function PaginaDeAlertas({
  searchParams,
}: {
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("alertas.ver");
  const podeGerenciar = operador.pode("alertas.gerenciar");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });

  const [resumo, alertas] = await Promise.all([
    resumoDeAlertas(periodo),
    listarAlertas({ situacao: params.situacao }),
  ]);

  return (
    <>
      <Cabecalho
        titulo="Alertas"
        descricao={
          resumo.totalRegistrado === 0
            ? "Nenhum alerta jamais registrado"
            : `${fmtNumero(resumo.abertos)} ${resumo.abertos === 1 ? "alerta aberto" : "alertas abertos"} · ${fmtNumero(resumo.criticos)} ${resumo.criticos === 1 ? "crítico" : "críticos"}`
        }
        acoes={
          <>
            <ReavaliarAgora podeGerenciar={podeGerenciar} />
            <SeletorDePeriodo />
          </>
        }
      />

      <Conteudo className="space-y-5">
        {resumo.totalRegistrado === 0 ? (
          <AguardandoInstrumentacao
            oQue="Incidentes abertos e o que exige atenção"
            tabela="Alert"
            comoLigar={
              <>
                Alertas nascem de quem observa: o agente do servidor de mídia
                (disco baixo, servidor fora do ar), a fila de transcodificação
                (trabalho falhando repetidas vezes) e o próprio produto (erro de
                reprodução acima do normal). Nenhum desses observadores está
                ligado ainda — o servidor de mídia não foi registrado, e sem ele
                não há o que observar.
                <br />
                <br />
                A chave <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">dedupeKey</code>{" "}
                já está no schema: o mesmo problema reabrindo incrementa
                ocorrências em vez de virar ruído novo na fila.
              </>
            }
            oQueVaiMostrar={[
              "Fila ordenada por gravidade, não por data — triagem antes de leitura cronológica.",
              "Quantas vezes o mesmo problema voltou, e desde quando está aberto.",
              "Reconhecer (alguém está olhando) separado de resolver (acabou).",
              "O que cada alerta aponta: qual servidor, qual episódio, qual arquivo.",
            ]}
          />
        ) : (
          <>
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Bloco titulo="A fila" descricao="Estado dos incidentes agora">
                <Razao>
                  <LinhaRazao
                    rotulo="Abertos"
                    valor={fmtNumero(resumo.abertos)}
                    sentido="menor-melhor"
                    destaque
                  />
                  <LinhaRazao
                    rotulo="Reconhecidos"
                    valor={fmtNumero(resumo.reconhecidos)}
                    nota="alguém está olhando, mas ainda não acabou"
                  />
                  <LinhaRazao
                    rotulo="Críticos em aberto"
                    valor={fmtNumero(resumo.criticos)}
                    sentido="menor-melhor"
                  />
                  <LinhaRazao
                    rotulo="Mais antigo em aberto"
                    valor={
                      resumo.maisAntigoAberto
                        ? fmtDesde(resumo.maisAntigoAberto)
                        : "nenhum"
                    }
                    sentido="menor-melhor"
                  />
                </Razao>
              </Bloco>

              <Bloco titulo="No período" descricao={periodo.rotulo}>
                <Razao>
                  <LinhaRazao
                    rotulo="Novos alertas"
                    valor={fmtNumero(resumo.novosNoPeriodo)}
                    sentido="menor-melhor"
                  />
                  <LinhaRazao
                    rotulo="Já resolvidos"
                    valor={fmtNumero(resumo.resolvidos)}
                    nota="acumulado de toda a história"
                  />
                </Razao>
              </Bloco>
            </div>

            <section className="painel-cartao overflow-hidden">
              <header className="border-b border-[var(--p-linha)] px-5 py-4">
                <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                  Incidentes
                </h2>
                <p className="mt-0.5 max-w-[74ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
                  Ordenados por gravidade, não por data. A fila é reavaliada a
                  cada batimento do agente — de minuto em minuto enquanto ele
                  estiver vivo — e uma vez por dia pelo agendador. Se o agente
                  parou, a tela de Servidor mostra o silêncio na hora, e
                  “Avaliar agora” força a passagem.
                </p>
              </header>
              <BarraDeFiltros>
                <Seletor
                  chave="situacao"
                  rotulo="Filtrar por situação"
                  opcoes={[
                    { valor: "", rotulo: "Toda situação" },
                    { valor: "OPEN", rotulo: "Abertos" },
                    { valor: "ACKNOWLEDGED", rotulo: "Reconhecidos" },
                    { valor: "RESOLVED", rotulo: "Resolvidos" },
                  ]}
                />
              </BarraDeFiltros>
              <ul className="divide-y divide-[var(--p-linha)]">
                {alertas.map((alerta) => (
                  <li key={alerta.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <Selo
                        tom={
                          alerta.severidade === "CRITICAL"
                            ? "perigo"
                            : alerta.severidade === "WARNING"
                              ? "atencao"
                              : "info"
                        }
                      >
                        {alerta.severidade.toLowerCase()}
                      </Selo>
                      <Selo
                        tom={alerta.situacao === "RESOLVED" ? "bom" : "neutro"}
                      >
                        {ROTULO_DE_SITUACAO[alerta.situacao] ?? alerta.situacao}
                      </Selo>
                      <span className="min-w-0 flex-1 text-[0.8125rem] text-[var(--p-texto)]">
                        {alerta.titulo}
                      </span>
                      <span className="text-[0.75rem] whitespace-nowrap text-[var(--p-fraco)]">
                        {fmtDesde(alerta.vistoEm)}
                      </span>
                      <AcoesDoAlerta
                        alertaId={alerta.id}
                        situacao={alerta.situacao}
                        podeGerenciar={podeGerenciar}
                      />
                    </div>
                    {alerta.detalhe ? (
                      <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
                        {alerta.detalhe}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[0.6875rem] text-[var(--p-fraco)]">
                      {alerta.tipo}
                      {alerta.entidade ? ` · ${alerta.entidade}` : ""}
                      {alerta.ocorrencias > 1
                        ? ` · ${fmtNumero(alerta.ocorrencias)} ocorrências`
                        : ""}
                      {` · aberto em ${fmtDataHora(alerta.abertoEm)}`}
                    </p>
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
