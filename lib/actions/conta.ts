"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { handleLivre, sugerirHandle } from "@/lib/auth/handles";
import { validarHandle, validarNome } from "@/lib/auth/identidade";
import {
  clearSessionCookie,
  getViewer,
  issueSessionCookie,
} from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";
import { abrirSessaoDoApp } from "@/lib/auth/app-session";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import { notificarEmSegundoPlano } from "@/lib/painel/discord/envio";

export type FormState = { erro?: string; campo?: string } | null;

const emailSchema = z
  .string()
  .trim()
  .min(5, "Informe um e-mail válido.")
  .email("Informe um e-mail válido.")
  .transform((value) => value.toLowerCase());

const senhaSchema = z
  .string()
  .min(8, "A senha precisa de pelo menos 8 caracteres.")
  .max(120);

const cadastroSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Como podemos te chamar?")
    .max(60, "Nome muito longo."),
  email: emailSchema,
  senha: senhaSchema,
});

export async function criarConta(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = cadastroSchema.safeParse({
    nome: formData.get("nome"),
    email: formData.get("email"),
    senha: formData.get("senha"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { erro: issue.message, campo: String(issue.path[0] ?? "") };
  }

  const { nome, email, senha } = parsed.data;

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return {
      erro: "Já existe uma conta com esse e-mail. Entre por ali.",
      campo: "email",
    };
  }

  const handle = await sugerirHandle(nome);

  const user = await db.user.create({
    data: {
      name: nome,
      email,
      handle,
      passwordHash: await hashPassword(senha),
      avatarSeed: String((handle.length % 9) + 1),
      onboardedAt: new Date(),
      preference: { create: {} },
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
    },
    select: { id: true },
  });

  const sessionId = await abrirSessaoDoApp(user.id);
  await issueSessionCookie(user.id, sessionId);
  await track({ type: "SIGN_UP", userId: user.id, sessionId });
  // Antes do redirect: ele lança, e nada depois dele roda.
  notificarEmSegundoPlano("cadastro");

  redirect(destinoSeguro(formData.get("destino")) ?? ROTA_INICIAL);
}

const entrarSchema = z.object({
  email: emailSchema,
  senha: z.string().min(1, "Digite sua senha."),
});

export async function entrar(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = entrarSchema.safeParse({
    email: formData.get("email"),
    senha: formData.get("senha"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { erro: issue.message, campo: String(issue.path[0] ?? "") };
  }

  const { email, senha } = parsed.data;
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, status: true, onboardedAt: true },
  });

  // Mensagem única para e-mail inexistente e senha errada.
  const generic = { erro: "E-mail ou senha não conferem.", campo: "senha" };
  if (!user || user.status !== "ACTIVE") return generic;
  if (!(await verifyPassword(senha, user.passwordHash))) return generic;

  const sessionId = await abrirSessaoDoApp(user.id);
  await issueSessionCookie(user.id, sessionId);
  await db.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });
  await track({ type: "SIGN_IN", userId: user.id, sessionId });

  const destino = destinoSeguro(formData.get("destino"));
  redirect(destino ?? ROTA_INICIAL);
}

export async function sair() {
  const viewer = await getViewer();
  if (viewer) {
    await track({
      type: "SIGN_OUT",
      userId: viewer.id,
      sessionId: viewer.appSessionId,
    });
    if (viewer.appSessionId) {
      await db.appSession
        .update({
          where: { id: viewer.appSessionId },
          data: { endedAt: new Date() },
        })
        .catch(() => {});
    }
  }
  await clearSessionCookie();
  redirect("/entrar");
}

const HANDLE_OCUPADO = "Esse @ acabou de ser escolhido por outra pessoa. Tente outra variação.";

function ehHandleDuplicado(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === "P2002" &&
    JSON.stringify(erro.meta ?? {}).includes("handle")
  );
}

/** Para o campo do @: responde enquanto a pessoa digita. */
export async function verificarHandle(
  entrada: string,
): Promise<{ disponivel: boolean; erro?: string }> {
  const viewer = await getViewer();
  if (!viewer) return { disponivel: false, erro: "Entre na sua conta para escolher um @." };
  const regra = validarHandle(entrada);
  if (!regra.ok) return { disponivel: false, erro: regra.erro };
  return { disponivel: await handleLivre(regra.handle, viewer.id) };
}

/**
 * Último passo de quem entrou pelo Google: confirma nome e @ e segue para
 * onde ia. Só devolve algo quando precisa de ajuste — dar certo é redirecionar.
 */
export async function concluirOnboarding(entrada: {
  nome: string;
  handle: string;
  destino?: string | null;
}): Promise<{ erro: string; campo?: "nome" | "handle" } | undefined> {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const nome = validarNome(entrada.nome);
  if (!nome.ok) return { erro: nome.erro, campo: "nome" };
  const handle = validarHandle(entrada.handle);
  if (!handle.ok) return { erro: handle.erro, campo: "handle" };
  if (!(await handleLivre(handle.handle, viewer.id))) {
    return { erro: HANDLE_OCUPADO, campo: "handle" };
  }

  try {
    await db.user.update({
      where: { id: viewer.id },
      data: { name: nome.nome, handle: handle.handle, onboardedAt: new Date() },
    });
  } catch (erro) {
    // Duas pessoas no mesmo segundo com o mesmo @: o banco decide.
    if (ehHandleDuplicado(erro)) return { erro: HANDLE_OCUPADO, campo: "handle" };
    throw erro;
  }

  await track({
    type: "ONBOARDING_COMPLETE",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    payload: { trocouNome: nome.nome !== viewer.name, trocouHandle: handle.handle !== viewer.handle },
  });

  revalidatePath("/", "layout");
  redirect(destinoSeguro(entrada.destino) ?? ROTA_INICIAL);
}

const preferenciasSchema = z.object({
  autoplayNext: z.boolean(),
  dataSaver: z.boolean(),
  reduceMotion: z.boolean(),
  spoilerGuard: z.boolean(),
  notifyReleases: z.boolean(),
  notifyCommunity: z.boolean(),
  preferredQuality: z.enum(["auto", "alta", "economia"]),
});

export async function salvarPreferencias(
  input: z.infer<typeof preferenciasSchema>,
) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const };

  const parsed = preferenciasSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const };

  await db.preference.upsert({
    where: { userId: viewer.id },
    create: { userId: viewer.id, ...parsed.data },
    update: parsed.data,
  });

  await track({
    type: "PREFERENCES_UPDATE",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    payload: parsed.data,
  });

  revalidatePath("/perfil/preferencias");
  return { ok: true as const };
}

export async function salvarPerfil(input: {
  nome: string;
  handle?: string;
  avatarSeed: string;
}): Promise<{ ok: true } | { ok: false; erro: string; campo?: "nome" | "handle" }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, erro: "Entre na sua conta de novo." };

  const nome = validarNome(input.nome);
  if (!nome.ok) return { ok: false, erro: nome.erro, campo: "nome" };
  if (!/^[1-9]$/.test(input.avatarSeed)) return { ok: false, erro: "Escolha uma cor." };

  let handle = viewer.handle;
  if (input.handle !== undefined) {
    const regra = validarHandle(input.handle);
    if (!regra.ok) return { ok: false, erro: regra.erro, campo: "handle" };
    if (!(await handleLivre(regra.handle, viewer.id))) {
      return { ok: false, erro: HANDLE_OCUPADO, campo: "handle" };
    }
    handle = regra.handle;
  }

  try {
    await db.user.update({
      where: { id: viewer.id },
      data: { name: nome.nome, handle, avatarSeed: input.avatarSeed },
    });
  } catch (erro) {
    if (ehHandleDuplicado(erro)) return { ok: false, erro: HANDLE_OCUPADO, campo: "handle" };
    throw erro;
  }
  revalidatePath("/perfil", "layout");
  return { ok: true };
}

/**
 * A troca de plano por ação do cliente foi REMOVIDA nesta fase.
 *
 * `alternarPlano` gravava `plan: "PREMIUM"` direto no banco a pedido do
 * navegador, sem cobrança nenhuma — na Fase 01 isso era uma demonstração
 * honesta, porque não havia o que cobrar. Com o paywall valendo, virou uma
 * ação de servidor que qualquer pessoa autenticada podia invocar para liberar
 * o catálogo inteiro de graça.
 *
 * O caminho agora é `/api/pagamentos/checkout`, e só um pagamento confirmado
 * pelo provedor concede direito. Cancelar é `DELETE /api/pagamentos/assinatura`.
 */
