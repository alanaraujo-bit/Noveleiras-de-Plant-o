import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import sharp from "sharp";

import { db } from "@/lib/db";
import { fotoDoElenco } from "@/lib/media/fotos-elenco";
import { avatarVersion, deleteAvatar, putAvatar } from "@/lib/media/avatars";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { operadorDaRota } from "@/lib/painel/guarda";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

function erro(mensagem: string, status: number) {
  return Response.json({ ok: false, erro: mensagem }, { status });
}

function mesmaOrigem(request: Request) {
  const origem = request.headers.get("origin");
  return !origem || origem === new URL(request.url).origin;
}

function formatoAceito(bytes: Uint8Array) {
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return jpg || png || webp;
}

async function pessoaParaEditar(personId: string) {
  return db.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      slug: true,
      name: true,
      photoKey: true,
      novelas: { select: { novela: { select: { slug: true } } } },
    },
  });
}

function atualizarTelas(pessoa: {
  id: string;
  slug: string;
  novelas: { novela: { slug: string } }[];
}) {
  revalidatePath(`/elenco/${pessoa.slug}`);
  revalidatePath(`/painel/elenco/${pessoa.id}`);
  revalidatePath("/painel/elenco");
  for (const { novela } of pessoa.novelas) revalidatePath(`/novela/${novela.slug}`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ personId: string }> },
) {
  if (!mesmaOrigem(request)) return erro("Origem não permitida.", 403);
  const acesso = await operadorDaRota("catalogo.editar");
  if (acesso.resposta) return acesso.resposta;
  const { personId } = await params;
  const pessoa = await pessoaParaEditar(personId);
  if (!pessoa) return erro("Pessoa não encontrada.", 404);

  const tamanho = Number(request.headers.get("content-length") ?? 0);
  if (tamanho > MAX_REQUEST_BYTES) return erro("A foto deve ter no máximo 5 MB.", 413);

  const form = await request.formData();
  const arquivo = form.get("foto");
  if (!(arquivo instanceof File) || arquivo.size === 0) return erro("Escolha uma foto para continuar.", 400);
  if (arquivo.size > MAX_FILE_BYTES) return erro("A foto deve ter no máximo 5 MB.", 413);

  const entrada = new Uint8Array(await arquivo.arrayBuffer());
  if (!formatoAceito(entrada)) return erro("Use uma imagem JPG, PNG ou WebP.", 415);

  let imagem: Buffer;
  try {
    imagem = await sharp(entrada, { failOn: "warning" })
      .rotate()
      .resize(512, 512, { fit: "cover", position: sharp.strategy.attention })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
  } catch {
    return erro("Não foi possível ler essa imagem. Escolha outra foto.", 422);
  }

  const chave = `elenco/${pessoa.id}/${randomUUID()}.webp`;
  try {
    await putAvatar(chave, imagem);
    await db.person.update({ where: { id: pessoa.id }, data: { photoKey: chave } });
  } catch (causa) {
    console.error("Falha ao salvar foto do elenco", causa);
    try { await deleteAvatar(chave); } catch { /* limpeza oportunista */ }
    return erro("Não foi possível salvar a foto agora. Tente de novo.", 503);
  }

  if (pessoa.photoKey?.startsWith("elenco/")) {
    try { await deleteAvatar(pessoa.photoKey); } catch (causa) { console.warn("Foto anterior do elenco não removida", causa); }
  }
  await registrarAuditoria(acesso.operador, {
    action: "catalogo.pessoa.foto.atualizar",
    targetType: "Person",
    targetId: pessoa.id,
    targetLabel: pessoa.name,
    before: { foto: pessoa.photoKey ? avatarVersion(pessoa.photoKey) : null },
    after: { foto: avatarVersion(chave) },
  });
  atualizarTelas(pessoa);
  return Response.json({ ok: true, fotoUrl: fotoDoElenco(pessoa.slug, chave) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ personId: string }> },
) {
  if (!mesmaOrigem(request)) return erro("Origem não permitida.", 403);
  const acesso = await operadorDaRota("catalogo.editar");
  if (acesso.resposta) return acesso.resposta;
  const { personId } = await params;
  const pessoa = await pessoaParaEditar(personId);
  if (!pessoa) return erro("Pessoa não encontrada.", 404);

  await db.person.update({ where: { id: pessoa.id }, data: { photoKey: null } });
  if (pessoa.photoKey?.startsWith("elenco/")) {
    try { await deleteAvatar(pessoa.photoKey); } catch (causa) { console.warn("Foto do elenco removida do banco, mas mantida no bucket", causa); }
  }
  await registrarAuditoria(acesso.operador, {
    action: "catalogo.pessoa.foto.remover",
    targetType: "Person",
    targetId: pessoa.id,
    targetLabel: pessoa.name,
    before: { foto: pessoa.photoKey ? avatarVersion(pessoa.photoKey) : null },
    after: { foto: null },
  });
  atualizarTelas(pessoa);
  return Response.json({ ok: true, fotoUrl: null });
}
