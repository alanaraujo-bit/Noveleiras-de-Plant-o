import { posterUrl } from "./resolver";

/** Fotos enviadas pelo painel têm endereço público versionado, sem expor o bucket. */
export function fotoDoElenco(slug: string, key: string | null): string | null {
  if (!key) return null;
  if (!key.startsWith("elenco/")) return posterUrl(key);
  const version = key.split("/").at(-1)?.replace(/\.webp$/, "");
  return `/api/elenco/${encodeURIComponent(slug)}/foto/${encodeURIComponent(version ?? "")}`;
}
