"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { db } from "@/lib/db";
import { hashPassword, verifyPassword, handleFromName } from "@/lib/auth/password";
import {
  clearSessionCookie,
  getViewer,
  issueSessionCookie,
} from "@/lib/auth/session";
import { track } from "@/lib/analytics/track";
import { lerDispositivo } from "@/lib/analytics/dispositivo";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";

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

async function openAppSession(userId: string) {
  const headerList = await headers();
  const userAgent = headerList.get("user-agent") ?? undefined;
  // Sistema e navegador saem do User-Agent aqui mesmo: o cliente refina isso
  // logo depois (tela, fuso, se está instalado), mas se ele nunca chegar a
  // rodar, a sessão continua sabendo de onde veio em vez de virar um buraco
  // na análise de dispositivos.
  const dispositivo = lerDispositivo(userAgent);
  const session = await db.appSession.create({
    data: {
      userId,
      deviceId: "pendente",
      osName: dispositivo.osName,
      browser: dispositivo.browser,
      platform: dispositivo.platform,
      userAgent: userAgent?.slice(0, 400),
      referrer: headerList.get("referer")?.slice(0, 300) ?? null,
    },
    select: { id: true },
  });
  return session.id;
}

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

  let handle = handleFromName(nome);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await db.user.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (!taken) break;
    handle = handleFromName(nome);
  }

  const user = await db.user.create({
    data: {
      name: nome,
      email,
      handle,
      passwordHash: await hashPassword(senha),
      avatarSeed: String((handle.length % 9) + 1),
      preference: { create: {} },
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
    },
    select: { id: true },
  });

  const sessionId = await openAppSession(user.id);
  await issueSessionCookie(user.id, sessionId);
  await track({ type: "SIGN_UP", userId: user.id, sessionId });

  redirect("/bem-vindo");
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

  const sessionId = await openAppSession(user.id);
  await issueSessionCookie(user.id, sessionId);
  await db.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });
  await track({ type: "SIGN_IN", userId: user.id, sessionId });

  const destino = destinoSeguro(formData.get("destino"));
  redirect(destino ?? (user.onboardedAt ? ROTA_INICIAL : "/bem-vindo"));
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

export async function concluirOnboarding(generoIds: string[]) {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const chosen = z
    .array(z.string())
    .max(12)
    .safeParse(generoIds);

  await db.user.update({
    where: { id: viewer.id },
    data: {
      onboardedAt: new Date(),
      preference: {
        upsert: {
          create: { favoriteGenreIds: chosen.success ? chosen.data : [] },
          update: { favoriteGenreIds: chosen.success ? chosen.data : [] },
        },
      },
    },
  });

  await track({
    type: "ONBOARDING_COMPLETE",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    payload: { generos: chosen.success ? chosen.data.length : 0 },
  });

  // O catalogo tambem muda com os generos escolhidos, mas quem acaba de
  // concluir o onboarding vai para o reel: e la que o app abre.
  revalidatePath("/inicio");
  redirect(ROTA_INICIAL);
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

export async function salvarGenerosPreferidos(generoIds: string[]) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const };
  const parsed = z.array(z.string()).max(12).safeParse(generoIds);
  if (!parsed.success) return { ok: false as const };

  await db.preference.upsert({
    where: { userId: viewer.id },
    create: { userId: viewer.id, favoriteGenreIds: parsed.data },
    update: { favoriteGenreIds: parsed.data },
  });

  revalidatePath("/inicio");
  return { ok: true as const };
}

export async function salvarPerfil(input: { nome: string; avatarSeed: string }) {
  const viewer = await getViewer();
  if (!viewer) return { ok: false as const };
  const parsed = z
    .object({ nome: z.string().trim().min(2).max(60), avatarSeed: z.string().max(2) })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const };

  await db.user.update({
    where: { id: viewer.id },
    data: { name: parsed.data.nome, avatarSeed: parsed.data.avatarSeed },
  });
  revalidatePath("/perfil");
  return { ok: true as const };
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
