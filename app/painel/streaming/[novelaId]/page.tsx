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
  novelaComTemporadas,
  resumoStreaming,
} from "@/lib/painel/metricas/streaming";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Streaming por novela" };

export default async function StreamingDaNovela({
  params,
  searchParams,
}: {
  params: Promise<{ novelaId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigirPermissao("streaming.ver");
  const [{ novelaId }, busca] = await Promise.all([params, searchParams]);
  const periodo = resolverPeriodo(busca.periodo, { de: busca.de, ate: busca.ate });
  const novela = await novelaComTemporadas(novelaId, periodo);
  if (!novela) notFound();

  const resumo = await resumoStreaming(periodo, { novelaId });
  const sufixo = sufixoDoPeriodo(busca);

  return (
    <>
      <Cabecalho
        titulo={novela.title}
        descricao={`${periodo.rotulo} · streaming por temporada`}
        acoes={<SeletorDePeriodo />}
      />
      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Streaming", href: `/painel/streaming${sufixo}` },
            { rotulo: novela.title },
          ]}
        />
        <ResumoDoStreaming resumo={resumo} periodoRotulo={periodo.rotulo} />
        <TabelaDeStreaming
          titulo="Temporadas"
          descricao="A audiência distinta é recalculada dentro de cada temporada"
          linhas={novela.linhas}
          nomeDaPrimeiraColuna="Temporada"
          vazio="Esta novela ainda não tem temporadas"
          hrefDaLinha={(linha) =>
            `/painel/streaming/${novelaId}/${linha.id}${sufixo}`
          }
        />
      </Conteudo>
    </>
  );
}
