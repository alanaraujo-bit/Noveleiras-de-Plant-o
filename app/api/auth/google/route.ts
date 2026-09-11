import { NextResponse } from "next/server";

import { destinoSeguro, ROTA_INICIAL } from "@/lib/auth/destino";
import {
  GOOGLE_FLOW_COOKIE,
  GOOGLE_FLOW_MAX_AGE,
  codificarFluxoGoogle,
  configuracaoGoogle,
  desafioPkce,
  novoFluxoGoogle,
  retornoGoogle,
} from "@/lib/auth/google";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const configuracao = configuracaoGoogle();
  const entrada = new URL(request.url);
  const destino = destinoSeguro(entrada.searchParams.get("destino")) ?? ROTA_INICIAL;
  const origem = entrada.searchParams.get("origem") === "criar-conta" ? "criar-conta" : "entrar";
  if (!configuracao) {
    const volta = new URL(`/${origem}`, entrada.origin);
    volta.searchParams.set("destino", destino);
    volta.searchParams.set("google", "configuracao");
    return NextResponse.redirect(volta);
  }

  const fluxo = novoFluxoGoogle(destino, origem);
  const autorizacao = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  autorizacao.searchParams.set("client_id", configuracao.clientId);
  autorizacao.searchParams.set("redirect_uri", retornoGoogle(request.url));
  autorizacao.searchParams.set("response_type", "code");
  autorizacao.searchParams.set("scope", "openid email profile");
  autorizacao.searchParams.set("state", fluxo.state);
  autorizacao.searchParams.set("nonce", fluxo.nonce);
  autorizacao.searchParams.set("code_challenge", desafioPkce(fluxo.verifier));
  autorizacao.searchParams.set("code_challenge_method", "S256");
  autorizacao.searchParams.set("prompt", "select_account");

  const resposta = NextResponse.redirect(autorizacao);
  resposta.cookies.set(GOOGLE_FLOW_COOKIE, codificarFluxoGoogle(fluxo), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GOOGLE_FLOW_MAX_AGE,
  });
  return resposta;
}
