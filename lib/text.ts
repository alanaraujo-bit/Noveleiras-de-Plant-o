// Decompõe (NFD) e descarta tudo fora do ASCII: os acentos viram marcas
// combinantes e caem fora, sem quebrar a palavra ao meio.
function deaccent(input: string): string {
  return input.normalize("NFD").replace(/[^\x00-\x7F]/g, "");
}

/** Minúsculas, sem acento, sem pontuação — base de busca e de slugs. */
export function normalizeText(input: string): string {
  return deaccent(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(input: string): string {
  return normalizeText(input).replace(/\s+/g, "-");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}
