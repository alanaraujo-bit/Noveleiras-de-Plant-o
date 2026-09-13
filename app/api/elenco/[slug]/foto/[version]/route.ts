import { db } from "@/lib/db";
import { avatarVersion, getAvatar } from "@/lib/media/avatars";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug, version } = await params;
  const pessoa = await db.person.findUnique({
    where: { slug },
    select: { photoKey: true },
  });

  if (
    !pessoa?.photoKey?.startsWith("elenco/") ||
    avatarVersion(pessoa.photoKey) !== version
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const objeto = await getAvatar(pessoa.photoKey);
    if (!objeto.Body) return new Response(null, { status: 404 });

    return new Response(objeto.Body.transformToWebStream(), {
      headers: {
        "Content-Type": objeto.ContentType ?? "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(objeto.ETag ? { ETag: objeto.ETag } : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (erro) {
    console.error("Falha ao carregar foto do elenco", erro);
    return new Response(null, { status: 404 });
  }
}
