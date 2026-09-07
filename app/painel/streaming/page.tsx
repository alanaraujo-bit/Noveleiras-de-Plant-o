import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  ResumoDoStreaming,
  TabelaDeStreaming,
} from "@/components/painel/Streaming";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  novelasStreaming,
  resumoStreaming,
} from "@/lib/painel/metricas/streaming";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Streaming" };

type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDeStreaming({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("streaming.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, { de: params.de, ate: params.ate });
  const [resumo, novelas] = await Promise.all([
    resumoStreaming(periodo),
    novelasStreaming(periodo),
  ]);
  const sufixo = sufixoDoPeriodo(params);

  return (
    <>
      <Cabecalho
        titulo="Streaming"
        descricao={`${periodo.rotulo} · consumo derivado de eventos e progresso reais`}
        acoes={<SeletorDePeriodo />}
      />
      <Conteudo className="space-y-5">
        <ResumoDoStreaming resumo={resumo} periodoRotulo={periodo.rotulo} />
        <TabelaDeStreaming
          titulo="Do catálogo ao play"
          descricao="Abra uma novela para separar temporadas e chegar ao episódio"
          linhas={novelas}
          nomeDaPrimeiraColuna="Novela"
          vazio="Nenhuma novela foi reproduzida no período"
          hrefDaLinha={(linha) => `/painel/streaming/${linha.id}${sufixo}`}
        />
      </Conteudo>
    </>
  );
}
