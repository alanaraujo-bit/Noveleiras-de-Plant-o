import { db } from "@/lib/db";
import { avatarVersion, getAvatar } from "@/lib/media/avatars";

export const runtime = "nodejs";

type Params = { params: Promise<{ userId: string; version: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { userId, version } = await params;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true },
  });

  if (!user?.avatarKey || avatarVersion(user.avatarKey) !== version) {
    return new Response(null, { status: 404 });
  }

  try {
    const object = await getAvatar(user.avatarKey);
    if (!object.Body) return new Response(null, { status: 404 });

    return new Response(object.Body.transformToWebStream(), {
      headers: {
        "Content-Type": object.ContentType ?? "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(object.ETag ? { ETag: object.ETag } : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Falha ao carregar avatar", error);
    return new Response(null, { status: 404 });
  }
}
