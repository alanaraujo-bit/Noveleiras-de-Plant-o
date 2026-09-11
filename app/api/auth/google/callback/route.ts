import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { track } from "@/lib/analytics/track";
import { abrirSessaoDoApp } from "@/lib/auth/app-session";
import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import {
  GOOGLE_FLOW_COOKIE,
  configuracaoGoogle,
  decodificarFluxoGoogle,
  retornoGoogle,
} from "@/lib/auth/google";
import { handleFromName, hashPassword } from "@/lib/auth/password";
import { issueSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
const CHAVES_GOOGLE = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function voltarComErro(
  origin: string,
  destino: string,
  erro: string,
  origem: "entrar" | "criar-conta" = "entrar",
) {
  const url = new URL(`/${origem}`, origin);
  url.searchParams.set("destino", destino);
  url.searchParams.set("google", erro);
  return NextResponse.redirect(url);
}

async function handleDisponivel(nome: string) {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const handle = handleFromName(nome);
    if (!(await db.user.findUnique({ where: { handle }, select: { id: true } }))) {
      return handle;
    }
  }
  return `noveleira${randomBytes(6).toString("hex")}`;
}

export async function GET(request: Request) {
  const entrada = new URL(request.url);
  const jar = await cookies();
  const fluxo = decodificarFluxoGoogle(jar.get(GOOGLE_FLOW_COOKIE)?.value);
  jar.delete(GOOGLE_FLOW_COOKIE);
  const destino = destinoSeguro(fluxo?.destino) ?? ROTA_INICIAL;
  const origem = fluxo?.origem ?? "entrar";
  const configuracao = configuracaoGoogle();

  if (entrada.searchParams.get("error") === "access_denied") {
    return voltarComErro(entrada.origin, destino, "cancelado", origem);
  }
  if (!configuracao || !fluxo || entrada.searchParams.get("state") !== fluxo.state) {
    return voltarComErro(entrada.origin, destino, "sessao", origem);
  }

  const code = entrada.searchParams.get("code");
  if (!code) return voltarComErro(entrada.origin, destino, "resposta", origem);

  try {
    const tokenResposta = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: configuracao.clientId,
        client_secret: configuracao.clientSecret,
        redirect_uri: retornoGoogle(request.url),
        grant_type: "authorization_code",
        code_verifier: fluxo.verifier,
      }),
      cache: "no-store",
    });
    const tokens = await tokenResposta.json().catch(() => null);
    if (!tokenResposta.ok || typeof tokens?.id_token !== "string") {
      return voltarComErro(entrada.origin, destino, "resposta", origem);
    }

    const { payload } = await jwtVerify(tokens.id_token, CHAVES_GOOGLE, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: configuracao.clientId,
      algorithms: ["RS256"],
    });
    if (
      payload.nonce !== fluxo.nonce ||
      payload.email_verified !== true ||
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) return voltarComErro(entrada.origin, destino, "identidade", origem);

    const email = payload.email.toLowerCase();
    const nome =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 60)
        : email.split("@")[0];
    let user = await db.user.findFirst({
      where: { OR: [{ googleSubject: payload.sub }, { email }] },
      select: { id: true, status: true, googleSubject: true },
    });
    const contaNova = !user;
    if (user?.googleSubject && user.googleSubject !== payload.sub) {
      return voltarComErro(entrada.origin, destino, "vinculo", origem);
    }
    if (!user) {
      user = await db.user.create({
        data: {
          email,
          name: nome,
          handle: await handleDisponivel(nome),
          passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
          googleSubject: payload.sub,
          onboardedAt: new Date(),
          lastSeenAt: new Date(),
          preference: { create: {} },
          subscription: { create: { plan: "FREE", status: "ACTIVE" } },
        },
        select: { id: true, status: true, googleSubject: true },
      });
    } else {
      if (user.status !== "ACTIVE") {
        return voltarComErro(entrada.origin, destino, "indisponivel", origem);
      }
      await db.user.update({
        where: { id: user.id },
        data: { googleSubject: payload.sub, lastSeenAt: new Date(), onboardedAt: new Date() },
      });
    }

    const sessionId = await abrirSessaoDoApp(user.id);
    await issueSessionCookie(user.id, sessionId);
    await track({
      type: contaNova ? "SIGN_UP" : "SIGN_IN",
      userId: user.id,
      sessionId,
      payload: { metodo: "google" },
    });
    return NextResponse.redirect(new URL(destino, entrada.origin));
  } catch (erro) {
    console.error("[auth/google] retorno inválido", erro);
    return voltarComErro(entrada.origin, destino, "erro", origem);
  }
}
