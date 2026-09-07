import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { GraficoBarras } from "@/components/painel/graficos";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  ResumoDoStreaming,
} from "@/components/painel/Streaming";
import { Bloco, Migalhas, Selo, Vazio } from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import { detalheDoEpisodio } from "@/lib/painel/metricas/streaming";
import { fmtDesde, fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Streaming do episódio" };

export default async function StreamingDoEpisodio({
  params,
  searchParams,
}: {
  params: Promise<{ novelaId: string; temporadaId: string; episodioId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigirPermissao("streaming.ver");
  const [{ novelaId, temporadaId, episodioId }, busca] = await Promise.all([
    params,
    searchParams,
  ]);
  const periodo = resolverPeriodo(busca.periodo, { de: busca.de, ate: busca.ate });
  const detalhe = await detalheDoEpisodio(
    novelaId,
    temporadaId,
    episodioId,
    periodo,
  );
  if (!detalhe) notFound();

  const { episodio, resumo, faixasAbandono, errosRecentes } = detalhe;
  const sufixo = sufixoDoPeriodo(busca);
  const pontosAbandono = faixasAbandono.map((valor, indice) => ({
    chave: String(indice),
    rotulo: `${indice * 25}–${(indice + 1) * 25}%`,
    valor,
  }));

  return (
    <>
      <Cabecalho
        titulo={`Ep. ${episodio.number} · ${episodio.title}`}
        descricao={`${episodio.novela.title} · temporada ${episodio.season.number} · ${periodo.rotulo}`}
        acoes={<SeletorDePeriodo />}
      />
      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Streaming", href: `/painel/streaming${sufixo}` },
            {
              rotulo: episodio.novela.title,
              href: `/painel/streaming/${novelaId}${sufixo}`,
            },
            {
              rotulo: `Temporada ${episodio.season.number}`,
              href: `/painel/streaming/${novelaId}/${temporadaId}${sufixo}`,
            },
            { rotulo: `Ep. ${episodio.number}` },
          ]}
        />
        <ResumoDoStreaming resumo={resumo} periodoRotulo={periodo.rotulo} />

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Onde o episódio foi deixado"
            descricao="Último progresso conhecido entre abandonos atualizados no período"
          >
            <GraficoBarras
              pontos={pontosAbandono}
              formato="numero"
              altura={210}
              vazio="Nenhum abandono conhecido neste recorte"
            />
          </Bloco>

          <Bloco
            titulo="Falhas de reprodução"
            descricao={`${fmtNumero(errosRecentes.length)} registros mais recentes no período`}
            compacto
          >
            {errosRecentes.length === 0 ? (
              <Vazio
                titulo="Nenhuma falha registrada"
                descricao="Um erro do player aparece aqui com horário e sessão para costurar a investigação nos logs."
              />
            ) : (
              <ul className="divide-y divide-[var(--p-linha)]">
                {errosRecentes.map((erro) => (
                  <li key={erro.id} className="flex items-center gap-3 py-2.5">
                    <Selo tom="perigo">erro</Selo>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] text-[var(--p-texto)]">
                        Falha ao reproduzir
                      </p>
                      <p className="truncate text-[0.6875rem] text-[var(--p-fraco)]">
                        {erro.sessionId ? `sessão ${erro.sessionId}` : "sessão não identificada"}
                      </p>
                    </div>
                    <time
                      dateTime={erro.createdAt.toISOString()}
                      className="shrink-0 text-[0.6875rem] text-[var(--p-fraco)]"
                    >
                      {fmtDesde(erro.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>

        <p className="text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
          Origem {episodio.mediaProvider.toLowerCase()} · formato {episodio.mediaFormat} · duração
          cadastrada de {Math.round(episodio.durationSec / 60)} min. Estes metadados descrevem o
          catálogo; os indicadores acima continuam vindo apenas de fatos de uso.
        </p>
      </Conteudo>
    </>
  );
}
