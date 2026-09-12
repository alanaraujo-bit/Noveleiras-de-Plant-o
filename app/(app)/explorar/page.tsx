import { getViewer } from "@/lib/auth/session";
import { getVitrine, type NovelaVitrine } from "@/lib/repositories/catalog";
import { getContinueWatching } from "@/lib/repositories/progresso";
import { getTrendingSearches } from "@/lib/repositories/busca";
import {
  FORCA_MINIMA,
  corpusDoCatalogo,
  perfilDeGosto,
  pontuar,
} from "@/lib/repositories/afinidade";
import { PLANO_ANUAL, PLANO_MENSAL, precoEmReais } from "@/lib/pagamentos/planos";
import { Vitrine, type ItemVitrine } from "./Vitrine";

export const metadata = { title: "Explorar" };

/**
 * Explorar.
 *
 * Era a Home — trilhos empilhados com destaque no topo. Depois que o Plantão
 * virou a porta de entrada, esta tela passou a ter outro trabalho: achar a
 * próxima novela. Por isso ela é uma vitrine só, com a busca no topo e filtros
 * que reordenam a mesma grade, em vez de seis trilhos que obrigavam a rolar
 * para os lados procurando.
 *
 * Visitante também entra: a Busca antiga funcionava sem conta, e escolher uma
 * novela não depende de login. Só o que é pessoal — retomar e "Para você" —
 * fica de fora até a pessoa entrar.
 */
export default async function ExplorarPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; buscar?: string }>;
}) {
  const [viewer, { filtro, buscar }, vitrine, buscados] = await Promise.all([
    getViewer(),
    searchParams,
    getVitrine(),
    getTrendingSearches(6),
  ]);

  const [continuar, paraVoce] = viewer
    ? await Promise.all([
        getContinueWatching(viewer.id, 1),
        ordemParaVoce(viewer.id, vitrine.novelas),
      ])
    : [[], null];

  return (
    <Vitrine
      pessoa={
        viewer
          ? {
              nome: viewer.name,
              avatarSeed: viewer.avatarSeed,
              avatarUrl: viewer.avatarUrl,
            }
          : null
      }
      reduzirMovimento={viewer?.preferences.reduceMotion ?? false}
      novelas={vitrine.novelas.map(paraItem)}
      temas={vitrine.temas}
      paraVoce={paraVoce}
      continuar={continuar[0] ?? null}
      buscados={buscados}
      filtroInicial={filtro ?? null}
      abrirBusca={buscar === "1"}
      assinatura={
        viewer && !viewer.entitlement.premium
          ? {
              episodiosGratis: viewer.entitlement.freePreviewEpisodes,
              mensal: precoEmReais(PLANO_MENSAL.precoCents),
              anual: precoEmReais(PLANO_ANUAL.precoCents),
            }
          : null
      }
    />
  );
}

function paraItem(novela: NovelaVitrine): ItemVitrine {
  return {
    id: novela.id,
    slug: novela.slug,
    title: novela.title,
    posterUrl: novela.posterUrl,
    episodeCount: novela.episodeCount,
    openAccess: novela.openAccess,
    assistidaAgora: novela.assistidaAgora,
    releasedAt: novela.releasedAt,
    temas: novela.temas,
  };
}

/**
 * "Para você" só existe quando o perfil de gosto tem sinal de verdade — a
 * mesma régua do reel. Abaixo dela, a lista seria popularidade com outro nome,
 * e um filtro que promete gosto e entrega ranking é pior que filtro nenhum.
 */
async function ordemParaVoce(
  userId: string,
  novelas: NovelaVitrine[],
): Promise<string[] | null> {
  const perfil = await perfilDeGosto(userId);
  if (perfil.forca < FORCA_MINIMA) return null;
  const corpus = await corpusDoCatalogo();

  const ordem = novelas
    .filter((n) => !perfil.engajadas.has(n.id) && !perfil.recusadas.has(n.id))
    .map((n) => ({
      id: n.id,
      pontuacao: pontuar(n.id, perfil, corpus, { popularidade: n.tendencia }),
    }))
    .filter((n) => n.pontuacao.motivo === "gosto")
    .sort((a, b) => b.pontuacao.valor - a.pontuacao.valor)
    .slice(0, 40)
    .map((n) => n.id);

  return ordem.length >= 6 ? ordem : null;
}
