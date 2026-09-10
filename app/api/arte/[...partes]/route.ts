import { db } from "@/lib/db";
import { artSpec, renderArt, type ArtFormat } from "@/lib/art";

const FORMATS = new Set<ArtFormat>(["capa", "hero", "cena"]);
const FALLBACK_ACCENT = "#c42a55";

/**
 * Serve a arte gerada do catálogo de demonstração.
 * Rotas: /api/arte/capa/<slug> · /api/arte/hero/<slug>
 *        /api/arte/cena/<slug>/<temporada-episodio>
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partes: string[] }> },
) {
  const { partes } = await params;
  const [rawFormat, slug, ...rest] = partes;
  const format = rawFormat as ArtFormat;

  if (!FORMATS.has(format) || !slug) {
    return new Response("Arte não encontrada", { status: 404 });
  }

  const accent =
    (await db.novela.findUnique({ where: { slug }, select: { accent: true } }))
      ?.accent ?? FALLBACK_ACCENT;

  const key = [format, slug, ...rest].join("/");
  const svg = renderArt(artSpec(format, key, accent));

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
