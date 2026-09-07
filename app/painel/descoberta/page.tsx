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
  ResumoDaDescoberta,
  TabelaDeTermos,
} from "@/components/painel/Descoberta";
import { Bloco } from "@/components/painel/primitivos";
import { BarrasRanking, SERIES } from "@/components/painel/graficos";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  destinosDaBusca,
  lacunasDeCatalogo,
  listarTermos,
  resumoDeDescoberta,
  type OrdemDeTermos,
} from "@/lib/painel/metricas/descoberta";
import { fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Descoberta" };

type Busca = Promise<Record<string, string | undefined>>;

const ORDENS: { valor: OrdemDeTermos; rotulo: string }[] = [
  { valor: "buscas", rotulo: "Mais buscados" },
  { valor: "sem-resultado", rotulo: "Mais frustrados" },
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "alfabetica", rotulo: "Ordem alfabética" },
];

export default async function PaginaDeDescoberta({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("busca.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });
  const sufixo = sufixoDoPeriodo(params);

  const [resumo, lacunas, destinos, termos] = await Promise.all([
    resumoDeDescoberta(periodo),
    lacunasDeCatalogo(periodo),
    destinosDaBusca(periodo),
    listarTermos({
      periodo,
      termo: params.q,
      apenasFalhas: params.falhas === "1",
      ordem: (params.ordem as OrdemDeTermos | undefined) ?? "buscas",
      pagina: Number(params.pagina ?? 1),
    }),
  ]);

  return (
    <>
      <Cabecalho
        titulo="Descoberta"
        descricao={`${periodo.rotulo} · ${fmtNumero(resumo.buscas.valor)} buscas registradas`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <ResumoDaDescoberta resumo={resumo} periodoRotulo={periodo.rotulo} />

        {/* --------------------------------------- demanda x entrega */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Procuraram e não acharam"
            descricao="Termos que voltaram vazios — a fila de pedidos que o catálogo ainda não atende"
          >
            <BarrasRanking
              itens={lacunas.map((item) => ({
                ...item,
                href: `/painel/descoberta/${encodeURIComponent(item.chave)}${sufixo}`,
              }))}
              cor={SERIES[1]}
              formato="numero"
              vazio="Nenhuma busca voltou vazia neste recorte"
            />
          </Bloco>

          <Bloco
            titulo="Para onde a busca leva"
            descricao="Novelas abertas a partir de um resultado de busca"
          >
            <BarrasRanking
              itens={destinos}
              formato="numero"
              vazio="Nenhuma busca terminou num título aberto"
            />
          </Bloco>
        </div>

        {/* ------------------------------------------------ termos */}
        <section className="painel-cartao overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] px-5 py-4">
            <div>
              <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                Termos buscados
              </h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                Agrupados pela forma normalizada; abra um termo para ver como
                foi escrito, o que devolveu e quem buscou
              </p>
            </div>
          </header>
          <BarraDeFiltros>
            <CampoDeBusca placeholder="Filtrar termo…" />
            <Alternador chave="falhas" rotulo="Só termos que já falharam" />
            <Seletor
              chave="ordem"
              rotulo="Ordenar termos"
              padrao="buscas"
              opcoes={ORDENS}
            />
          </BarraDeFiltros>
          <TabelaDeTermos
            linhas={termos.linhas}
            vazio={
              params.q || params.falhas === "1"
                ? "Nenhum termo corresponde a este filtro"
                : "Ninguém buscou nada neste recorte"
            }
            hrefDaLinha={(linha) =>
              `/painel/descoberta/${encodeURIComponent(linha.termo)}${sufixo}`
            }
          />
          <Paginacao
            pagina={termos.pagina}
            paginas={termos.paginas}
            total={termos.total}
            rotuloItem="termos"
          />
        </section>
      </Conteudo>
    </>
  );
}
