import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import sharp from "sharp";

import { getViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { avatarUrl, deleteAvatar, putAvatar } from "@/lib/media/avatars";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, message }, { status });
}

function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function hasSupportedSignature(bytes: Uint8Array): boolean {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const webp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return jpeg || png || webp;
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return jsonError("Origem não permitida.", 403);

  const viewer = await getViewer();
  if (!viewer) return jsonError("Entre na sua conta para trocar a foto.", 401);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonError("A foto deve ter no máximo 5 MB.", 413);
  }

  const formData = await request.formData();
  const file = formData.get("foto");
  if (!(file instanceof File) || file.size === 0) {
    return jsonError("Escolha uma foto para continuar.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonError("A foto deve ter no máximo 5 MB.", 413);
  }

  const input = new Uint8Array(await file.arrayBuffer());
  if (!hasSupportedSignature(input)) {
    return jsonError("Use uma imagem JPG, PNG ou WebP.", 415);
  }

  let output: Buffer;
  try {
    output = await sharp(input, { failOn: "warning" })
      .rotate()
      .resize(512, 512, {
        fit: "cover",
        position: sharp.strategy.attention,
        withoutEnlargement: false,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch {
    return jsonError("Não foi possível ler essa imagem. Escolha outra foto.", 422);
  }

  const current = await db.user.findUnique({
    where: { id: viewer.id },
    select: { avatarKey: true },
  });
  const key = `avatars/${viewer.id}/${randomUUID()}.webp`;

  try {
    await putAvatar(key, output);
    await db.user.update({
      where: { id: viewer.id },
      data: { avatarKey: key },
    });
  } catch (error) {
    console.error("Falha ao salvar avatar", error);
    try {
      await deleteAvatar(key);
    } catch {
      // A limpeza é oportunista; a falha original continua sendo a relevante.
    }
    return jsonError("Não foi possível salvar a foto agora. Tente novamente.", 503);
  }

  if (current?.avatarKey) {
    try {
      await deleteAvatar(current.avatarKey);
    } catch (error) {
      console.warn("Avatar anterior não removido", error);
    }
  }

  revalidatePath("/inicio");
  revalidatePath("/perfil");
  revalidatePath("/perfil/preferencias");
  revalidatePath("/feed");

  return Response.json({ ok: true, avatarUrl: avatarUrl(viewer.id, key) });
}

export async function DELETE(request: Request) {
  if (!requestIsSameOrigin(request)) return jsonError("Origem não permitida.", 403);

  const viewer = await getViewer();
  if (!viewer) return jsonError("Entre na sua conta para remover a foto.", 401);

  const current = await db.user.findUnique({
    where: { id: viewer.id },
    select: { avatarKey: true },
  });
  await db.user.update({
    where: { id: viewer.id },
    data: { avatarKey: null },
  });

  if (current?.avatarKey) {
    try {
      await deleteAvatar(current.avatarKey);
    } catch (error) {
      console.warn("Avatar removido do perfil, mas mantido no bucket", error);
    }
  }

  revalidatePath("/inicio");
  revalidatePath("/perfil");
  revalidatePath("/perfil/preferencias");
  revalidatePath("/feed");

  return Response.json({ ok: true });
}
