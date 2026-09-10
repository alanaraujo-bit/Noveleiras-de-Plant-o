import {
  getSearchSuggestions,
  getTrendingSearches,
} from "@/lib/repositories/busca";
import { PainelBusca } from "./PainelBusca";

export const metadata = { title: "Buscar" };

export default async function BuscarPage() {
  const [sugestoes, populares] = await Promise.all([
    getSearchSuggestions(8),
    getTrendingSearches(6),
  ]);

  return (
    <PainelBusca
      populares={sugestoes.popular}
      tags={sugestoes.topTags}
      buscados={populares}
    />
  );
}
