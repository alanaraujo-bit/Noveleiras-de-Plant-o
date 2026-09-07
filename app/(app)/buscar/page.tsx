import {
  getSearchSuggestions,
  getTrendingSearches,
} from "@/lib/repositories/busca";
import { listGenres } from "@/lib/repositories/catalog";
import { PainelBusca } from "./PainelBusca";

export const metadata = { title: "Buscar" };

export default async function BuscarPage() {
  const [sugestoes, populares, generos] = await Promise.all([
    getSearchSuggestions(8),
    getTrendingSearches(6),
    listGenres(),
  ]);

  return (
    <PainelBusca
      populares={sugestoes.popular}
      tags={sugestoes.topTags}
      buscados={populares}
      generos={generos.map((genero) => ({
        slug: genero.slug,
        name: genero.name,
        accent: genero.accent,
      }))}
    />
  );
}
