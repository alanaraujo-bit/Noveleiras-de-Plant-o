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
  ResumoDoCatalogoBloco,
  TabelaDeContadores,
  TabelaDoCatalogo,
} from "@/components/painel/Catalogo";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  divergenciaDeContadores,
  listarNovelas,
  resumoDoCatalogo,
  type OrdemDoCatalogo,
} from "@/lib/painel/metricas/catalogo";
import { fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Catálogo" };

type Busca = Promise<Record<string, string | undefined>>;

const ORDENS: { valor: OrdemDoCatalogo; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Estreia mais recente" },
  { valor: "titulo", rotulo: "Ordem alfabética" },
  { valor: "episodios", rotulo: "Mais episódios" },
  { valor: "duracao", rotulo: "Mais longas (nesta página)" },
  { valor: "divergencia", rotulo: "Contador mais divergente (nesta página)" },
];

export default async function PaginaDoCatalogo({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("catalogo.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });
  const sufixo = sufixoDoPeriodo(params);

  const [resumo, contadores, novelas] = await Promise.all([
    resumoDoCatalogo(periodo),
    divergenciaDeContadores(),
    listarNovelas({
      termo: params.q,
      status: params.status,
      tier: params.tier,
      apenasDestaques: params.destaque === "1",
      ordem: (params.ordem as OrdemDoCatalogo | undefined) ?? "recentes",
      pagina: Number(params.pagina ?? 1),
    }),
  ]);

  return (
    <>
      <Cabecalho
        titulo="Catálogo"
        descricao={`${fmtNumero(resumo.novelas)} novelas · ${fmtNumero(resumo.temporadas)} temporadas · ${fmtNumero(resumo.episodios)} episódios`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <ResumoDoCatalogoBloco resumo={resumo} periodoRotulo={periodo.rotulo} />

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Contadores contra os fatos
            </h2>
            <p className="mt-0.5 max-w-[70ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
              As colunas denormalizadas do catálogo foram semeadas com números
              de vitrine. Aqui elas aparecem ao lado do que os eventos
              realmente registram — a divergência é o motivo de nenhuma métrica
              do painel ler essas colunas.
            </p>
          </header>
          <TabelaDeContadores
            linhas={contadores.linhas}
            totalDivergentes={contadores.totalDivergentes}
          />
        </section>

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Novelas
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              Abra uma novela para ver temporadas, episódios, mídia associada e
              lacunas de numeração
            </p>
          </header>
          <BarraDeFiltros>
            <CampoDeBusca placeholder="Buscar título, slug ou ID…" />
            <Seletor
              chave="status"
              rotulo="Filtrar por status"
              opcoes={[
                { valor: "", rotulo: "Todos os status" },
                { valor: "ONGOING", rotulo: "Em exibição" },
                { valor: "COMPLETED", rotulo: "Concluídas" },
                { valor: "COMING_SOON", rotulo: "Em breve" },
              ]}
            />
            <Seletor
              chave="tier"
              rotulo="Filtrar por acesso"
              opcoes={[
                { valor: "", rotulo: "Todo acesso" },
                { valor: "FREE", rotulo: "Aberto" },
                { valor: "PREMIUM", rotulo: "Assinantes" },
              ]}
            />
            <Alternador chave="destaque" rotulo="Só destaques" />
            <Seletor
              chave="ordem"
              rotulo="Ordenar novelas"
              padrao="recentes"
              opcoes={ORDENS}
            />
          </BarraDeFiltros>
          <TabelaDoCatalogo
            linhas={novelas.linhas}
            vazio={
              params.q || params.status || params.tier || params.destaque === "1"
                ? "Nenhuma novela corresponde a este filtro"
                : "O catálogo está vazio"
            }
            hrefDaLinha={(linha) => `/painel/catalogo/${linha.id}${sufixo}`}
          />
          <Paginacao
            pagina={novelas.pagina}
            paginas={novelas.paginas}
            total={novelas.total}
            rotuloItem="novelas"
          />
        </section>
      </Conteudo>
    </>
  );
}
