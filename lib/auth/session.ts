import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";

import { db } from "@/lib/db";
import {
  ANONYMOUS_ENTITLEMENT,
  entitlementFrom,
  type Entitlement,
} from "@/lib/access/entitlements";
import type { Role } from "@prisma/client";

const COOKIE = "nvl_sessao";
export const DEVICE_COOKIE = "nvl_dispositivo";
const MAX_AGE_S = 60 * 60 * 24 * 60; // 60 dias

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 24) {
    throw new Error(
      "SESSION_SECRET ausente ou curto demais. Defina 32+ bytes aleatórios.",
    );
  }
  return new TextEncoder().encode(raw);
}

type Claims = { sub: string; sid: string };

export async function issueSessionCookie(userId: string, appSessionId: string) {
  const token = await new SignJWT({ sid: appSessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

async function readClaims(): Promise<Claims | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { sub: payload.sub, sid: String(payload.sid ?? "") };
  } catch {
    return null;
  }
}

export type Viewer = {
  id: string;
  name: string;
  handle: string;
  email: string;
  avatarSeed: string;
  role: Role;
  onboardedAt: Date | null;
  appSessionId: string;
  entitlement: Entitlement;
  preferences: {
    favoriteGenreIds: string[];
    autoplayNext: boolean;
    dataSaver: boolean;
    reduceMotion: boolean;
    spoilerGuard: boolean;
    notifyReleases: boolean;
    notifyCommunity: boolean;
    preferredQuality: string;
  };
};

/**
 * Espectador atual. Memoizado por requisição — chamar em vários componentes
 * de servidor custa uma consulta só.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const claims = await readClaims();
  if (!claims) return null;

  const user = await db.user.findFirst({
    where: { id: claims.sub, status: "ACTIVE" },
    include: { subscription: true, preference: true },
  });
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    handle: user.handle,
    email: user.email,
    avatarSeed: user.avatarSeed,
    role: user.role,
    onboardedAt: user.onboardedAt,
    appSessionId: claims.sid,
    entitlement: entitlementFrom(user.subscription),
    preferences: {
      favoriteGenreIds: user.preference?.favoriteGenreIds ?? [],
      autoplayNext: user.preference?.autoplayNext ?? true,
      dataSaver: user.preference?.dataSaver ?? false,
      reduceMotion: user.preference?.reduceMotion ?? false,
      spoilerGuard: user.preference?.spoilerGuard ?? true,
      notifyReleases: user.preference?.notifyReleases ?? true,
      notifyCommunity: user.preference?.notifyCommunity ?? true,
      preferredQuality: user.preference?.preferredQuality ?? "auto",
    },
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new Error("UNAUTHENTICATED");
  return viewer;
}

export async function currentEntitlement(): Promise<Entitlement> {
  const viewer = await getViewer();
  return viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT;
}
