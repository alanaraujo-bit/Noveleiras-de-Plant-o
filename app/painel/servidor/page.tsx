import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { AguardandoInstrumentacao } from "@/components/painel/Instrumentacao";
import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
} from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  listarServidores,
  resumoDeServidores,
} from "@/lib/painel/metricas/infraestrutura";
import { fmtDesde, fmtDuracao, fmtNumero } from "@/lib/painel/numeros";

export const metadata = { title: "Servidor" };

const ROTULO_DE_SITUACAO: Record<string, string> = {
  UNKNOWN: "sem notícia",
  ONLINE: "no ar",
  DEGRADED: "degradado",
  OFFLINE: "fora do ar",
};

function tomDaSituacao(situacao: string) {
  if (situacao === "ONLINE") return "bom" as const;
  if (situacao === "DEGRADED") return "atencao" as const;
  if (situacao === "OFFLINE") return "perigo" as const;
  return "neutro" as const;
}

function barra(usado: number | null, total: number | null) {
  if (usado === null || total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, (usado / total) * 100));
}

export default async function PaginaDeServidor() {
  await exigirPermissao("servidor.ver");

  const [servidores, resumo] = await Promise.all([
    listarServidores(),
    resumoDeServidores(),
  ]);

  const noAr = servidores.filter((s) => s.situacao === "ONLINE").length;

  return (
    <>
      <Cabecalho
        titulo="Servidor"
        descricao={
          resumo.servidores === 0
            ? "Nenhum servidor de mídia registrado"
            : `${fmtNumero(noAr)} de ${fmtNumero(resumo.servidores)} no ar · ${fmtNumero(resumo.batimentos)} batimentos recebidos`
        }
      />

      <Conteudo className="space-y-5">
        {resumo.servidores === 0 ? (
          <AguardandoInstrumentacao
            oQue="Saúde, recursos e controles do servidor de mídia"
            tabela="MediaServer"
            comoLigar={
              <>
                O schema é plural desde o começo: hoje pode ser um computador em
                casa, amanhã vários nós ou uma origem em nuvem — a tela lista em
                vez de assumir um. O que falta é registrar o primeiro e dar a ele
                um segredo compartilhado, cujo hash fica em{" "}
                <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">
                  tokenHash
                </code>
                .
                <br />
                <br />
                A partir daí um agente rodando na máquina envia batimentos —
                CPU, RAM, disco, streams ativos, profundidade da fila — e cada
                batimento vira uma linha de{" "}
                <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">
                  MediaServerBeat
                </code>
                . O estado atual sai do último; os gráficos, da janela.
              </>
            }
            oQueVaiMostrar={[
              "CPU, memória, GPU e disco de cada nó, com o quanto já foi consumido.",
              "Streams ativos e profundidade da fila no momento.",
              "Há quanto tempo o servidor está no ar e qual versão do agente roda nele.",
              "Silêncio detectado: um servidor que parou de bater vira alerta em vez de sumir da tela.",
            ]}
          />
        ) : (
          <div className={`grid items-start gap-5 ${servidores.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {servidores.map((servidor) => {
              const ram = barra(servidor.ultimo?.ramUsada ?? null, servidor.ultimo?.ramTotal ?? null);
              const disco = barra(
                servidor.ultimo?.discoUsado ?? null,
                servidor.ultimo?.discoTotal ?? null,
              );
              return (
                <Bloco
                  key={servidor.id}
                  titulo={servidor.nome}
                  descricao={`${servidor.slug} · ${servidor.tipo.toLowerCase()}`}
                  acao={
                    <span className="flex items-center gap-1.5">
                      {!servidor.habilitado ? (
                        <Selo tom="neutro">desabilitado</Selo>
                      ) : null}
                      <Selo tom={tomDaSituacao(servidor.situacao)}>
                        {ROTULO_DE_SITUACAO[servidor.situacao] ?? servidor.situacao}
                      </Selo>
                    </span>
                  }
                >
                  {servidor.ultimo === null ? (
                    <p className="py-6 text-center text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
                      Registrado, mas nenhum batimento chegou ainda. O agente
                      pode não ter sido instalado, ou o segredo não confere.
                    </p>
                  ) : (
                    <Razao>
                      <LinhaRazao
                        rotulo="CPU"
                        valor={
                          servidor.ultimo.cpu === null
                            ? "—"
                            : `${Math.round(servidor.ultimo.cpu)}%`
                        }
                        sentido="menor-melhor"
                        destaque
                      />
                      <LinhaRazao
                        rotulo="Memória"
                        valor={ram === null ? "—" : `${Math.round(ram)}%`}
                        sentido="menor-melhor"
                        nota={
                          servidor.ultimo.ramTotal
                            ? `${fmtNumero(servidor.ultimo.ramUsada ?? 0)} de ${fmtNumero(servidor.ultimo.ramTotal)} MB`
                            : undefined
                        }
                      />
                      <LinhaRazao
                        rotulo="Disco"
                        valor={disco === null ? "—" : `${Math.round(disco)}%`}
                        sentido="menor-melhor"
                        nota={
                          servidor.ultimo.discoTotal
                            ? `${Math.round(servidor.ultimo.discoUsado ?? 0)} de ${Math.round(servidor.ultimo.discoTotal)} GB`
                            : undefined
                        }
                      />
                      <LinhaRazao
                        rotulo="Streams ativos"
                        valor={fmtNumero(servidor.ultimo.streams)}
                      />
                      <LinhaRazao
                        rotulo="Transcodificando"
                        valor={fmtNumero(servidor.ultimo.transcodes)}
                        nota={`${fmtNumero(servidor.ultimo.fila)} na fila`}
                      />
                      <LinhaRazao
                        rotulo="Último batimento"
                        valor={
                          servidor.ultimoBatimento
                            ? fmtDesde(servidor.ultimoBatimento)
                            : "nunca"
                        }
                        nota={
                          servidor.uptimeSec
                            ? `máquina ligada há ${fmtDuracao(servidor.uptimeSec * 1000)}`
                            : undefined
                        }
                      />
                    </Razao>
                  )}
                  {/* Silêncio é informação: a situação vem de quando o último
                      batimento chegou, não do que ele afirmou. Quando as duas
                      leituras divergem, quem manda é o relógio. */}
                  {servidor.situacao === "OFFLINE" && servidor.ultimoBatimento ? (
                    <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.75rem] leading-relaxed text-[var(--p-atencao)]">
                      Nenhum batimento nos últimos minutos. Os números acima são
                      a última leitura recebida, não o estado de agora — o agente
                      pode ter parado, ou a máquina.
                    </p>
                  ) : null}
                  {servidor.notas ? (
                    <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
                      {servidor.notas}
                    </p>
                  ) : null}
                </Bloco>
              );
            })}
          </div>
        )}
      </Conteudo>
    </>
  );
}
