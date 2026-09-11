import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_FLOW_COOKIE = "nvl_google_fluxo";
export const GOOGLE_FLOW_MAX_AGE = 10 * 60;

export type FluxoGoogle = {
  state: string;
  nonce: string;
  verifier: string;
  destino: string;
  origem: "entrar" | "criar-conta";
};

export function configuracaoGoogle() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function novoFluxoGoogle(
  destino: string,
  origem: FluxoGoogle["origem"] = "entrar",
): FluxoGoogle {
  return {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    destino,
    origem,
  };
}

export function desafioPkce(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function codificarFluxoGoogle(fluxo: FluxoGoogle) {
  return Buffer.from(JSON.stringify(fluxo), "utf8").toString("base64url");
}

export function decodificarFluxoGoogle(valor?: string): FluxoGoogle | null {
  if (!valor || valor.length > 2048) return null;
  try {
    const fluxo = JSON.parse(Buffer.from(valor, "base64url").toString("utf8"));
    if (
      typeof fluxo?.state !== "string" ||
      typeof fluxo?.nonce !== "string" ||
      typeof fluxo?.verifier !== "string" ||
      typeof fluxo?.destino !== "string" ||
      (fluxo?.origem !== "entrar" && fluxo?.origem !== "criar-conta")
    ) return null;
    return fluxo;
  } catch {
    return null;
  }
}

export function retornoGoogle(requestUrl: string) {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${new URL(requestUrl).origin}/api/auth/google/callback`
  );
}
