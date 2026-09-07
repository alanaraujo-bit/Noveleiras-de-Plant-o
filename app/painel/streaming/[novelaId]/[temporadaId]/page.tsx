import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  ResumoDoStreaming,
  TabelaDeStreaming,
} from "@/components/painel/Streaming";
import { Migalhas } from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  resumoStreaming,
  temporadaComEpisodios,
} from "@/lib/painel/metricas/streaming";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Streaming por temporada" };

export default async function StreamingDaTemporada({
  params,
  searchParams,
}: {
  params: Promise<{ novelaId: string; temporadaId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigirPermissao("streaming.ver");
  const [{ novelaId, temporadaId }, busca] = await Promise.all([params, searchParams]);
  const periodo = resolverPeriodo(busca.periodo, { de: busca.de, ate: busca.ate });
  const temporada = await temporadaComEpisodios(novelaId, temporadaId, periodo);
  if (!temporada) notFound();

  const resumo = await resumoStreaming(periodo, { episodeIds: temporada.episodeIds });
  const sufixo = sufixoDoPeriodo(busca);

  return (
    <>
      <Cabecalho
        titulo={`Temporada ${temporada.number}`}
        descricao={`${temporada.novela.title} · ${periodo.rotulo}`}
        acoes={<SeletorDePeriodo />}
      />
      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Streaming", href: `/painel/streaming${sufixo}` },
            {
              rotulo: temporada.novela.title,
              href: `/painel/streaming/${novelaId}${sufixo}`,
            },
            { rotulo: `Temporada ${temporada.number}` },
          ]}
        />
        <ResumoDoStreaming resumo={resumo} periodoRotulo={periodo.rotulo} />
        <TabelaDeStreaming
          titulo="Episódios"
          descricao="Conclusão, abandono e erro por episódio"
          linhas={temporada.linhas}
          nomeDaPrimeiraColuna="Episódio"
          vazio="Esta temporada ainda não tem episódios"
          hrefDaLinha={(linha) =>
            `/painel/streaming/${novelaId}/${temporadaId}/${linha.id}${sufixo}`
          }
        />
      </Conteudo>
    </>
  );
}
