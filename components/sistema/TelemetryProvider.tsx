"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { usePathname } from "next/navigation";

/**
 * Telemetria do cliente.
 *
 * Abre (ou reaproveita) uma sessão de aplicativo, descreve o dispositivo, envia
 * batimentos de tempo de uso e enfileira eventos em lote. Nada aqui bloqueia a
 * interface: falha de rede simplesmente descarta o lote.
 *
 * É a metade cliente do que o painel da Fase 02 vai ler: sessões, tempo dentro
 * da plataforma, telas visitadas, dispositivos.
 */

type EventName =
  | "SCREEN_VIEW"
  | "NOVELA_VIEW"
  | "EPISODE_VIEW"
  | "PLAY_START"
  | "PLAY_PROGRESS"
  | "PLAY_PAUSE"
  | "PLAY_SEEK"
  | "PLAY_COMPLETE"
  | "PLAY_ABANDON"
  | "PLAY_ERROR"
  | "SEARCH_RESULT_CLICK"
  | "CATEGORY_OPEN"
  | "FEED_VIEW"
  | "PAYWALL_VIEW"
  | "PAYWALL_CTA"
  | "CHECKOUT_START"
  | "CHECKOUT_APPROVED"
  | "CHECKOUT_REJECTED"
  | "PURCHASE_COMPLETE"
  | "SUBSCRIPTION_CANCEL"
  | "PWA_INSTALLED"
  | "CLIENT_ERROR";

export type TrackPayload = {
  entityType?: string;
  entityId?: string;
  novelaId?: string;
  episodeId?: string;
  valueMs?: number;
  payload?: Record<string, unknown>;
};

type QueuedEvent = TrackPayload & {
  type: EventName;
  path: string;
  at: number;
};

type TelemetryApi = {
  track: (type: EventName, data?: TrackPayload) => void;
  sessionId: () => string | null;
};

const TelemetryContext = createContext<TelemetryApi>({
  track: () => {},
  sessionId: () => null,
});

const DEVICE_STORAGE_KEY = "nvl.dispositivo";
const SESSION_STORAGE_KEY = "nvl.sessao";
const FLUSH_INTERVAL_MS = 9_000;
const HEARTBEAT_MS = 30_000;

function readStorage(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(store: Storage | undefined, key: string, value: string) {
  try {
    store?.setItem(key, value);
  } catch {
    /* modo privado: seguimos sem persistir */
  }
}

function deviceId(): string {
  if (typeof window === "undefined") return "servidor";
  const existing = readStorage(window.localStorage, DEVICE_STORAGE_KEY);
  if (existing) return existing;
  const fresh =
    globalThis.crypto?.randomUUID?.() ??
    `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  writeStorage(window.localStorage, DEVICE_STORAGE_KEY, fresh);
  return fresh;
}

function describeDevice() {
  const ua = navigator.userAgent;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS expõe isso fora do padrão.
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true;

  const osName = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Outro";

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Safari\//i.test(ua)
          ? "Safari"
          : /Firefox\//i.test(ua)
            ? "Firefox"
            : "Outro";

  return {
    deviceId: deviceId(),
    platform: standalone ? "pwa" : "web",
    osName,
    browser,
    screenW: window.screen?.width ?? null,
    screenH: window.screen?.height ?? null,
    standalone,
    userAgent: ua.slice(0, 400),
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer || null,
  };
}

export function TelemetryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // O painel administrativo não é uso do produto.
  //
  // Sem esta linha, cada tela do painel viraria um SCREEN_VIEW e cada operador
  // olhando a operação viraria um usuário ativo — o painel inflaria justamente
  // os números que ele existe para mostrar. Quem opera não é audiência.
  const noPainel = pathname?.startsWith("/painel") ?? false;
  const sessionRef = useRef<string | null>(null);
  const queueRef = useRef<QueuedEvent[]>([]);
  const activeMsRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const screenViewsRef = useRef(0);

  const flush = useCallback((useBeacon = false) => {
    const events = queueRef.current;
    if (events.length === 0) return;
    queueRef.current = [];

    const body = JSON.stringify({
      sessionId: sessionRef.current,
      deviceId: deviceId(),
      events,
    });

    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/telemetria/eventos",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }

    void fetch("/api/telemetria/eventos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* telemetria nunca atrapalha a navegação */
    });
  }, []);

  const track = useCallback(
    (type: EventName, data: TrackPayload = {}) => {
      queueRef.current.push({
        ...data,
        type,
        path: window.location.pathname,
        at: Date.now(),
      });
      if (queueRef.current.length >= 20) flush();
    },
    [flush],
  );

  // Abertura de sessão + descrição do dispositivo.
  useEffect(() => {
    if (noPainel) return;
    let cancelled = false;
    const cached = readStorage(window.sessionStorage, SESSION_STORAGE_KEY);
    if (cached) sessionRef.current = cached;

    void fetch("/api/telemetria/sessao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...describeDevice(), sessionId: cached }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { sessionId?: string } | null) => {
        if (cancelled || !data?.sessionId) return;
        sessionRef.current = data.sessionId;
        writeStorage(window.sessionStorage, SESSION_STORAGE_KEY, data.sessionId);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [noPainel]);

  // Tempo dentro da plataforma: só conta enquanto a aba está visível.
  useEffect(() => {
    if (noPainel) return;
    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === "visible") {
        activeMsRef.current += now - lastTickRef.current;
      }
      lastTickRef.current = now;
    };

    const beat = () => {
      tick();
      const activeMs = activeMsRef.current;
      if (!sessionRef.current || activeMs < 1000) return;
      activeMsRef.current = 0;
      void fetch("/api/telemetria/sessao", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionRef.current,
          activeMs,
          screenViews: screenViewsRef.current,
        }),
        keepalive: true,
      }).catch(() => {});
      screenViewsRef.current = 0;
    };

    const onVisibility = () => {
      tick();
      if (document.visibilityState === "hidden") {
        beat();
        flush(true);
      } else {
        lastTickRef.current = Date.now();
      }
    };

    const heartbeat = window.setInterval(beat, HEARTBEAT_MS);
    const flusher = window.setInterval(() => flush(), FLUSH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onVisibility);

    return () => {
      window.clearInterval(heartbeat);
      window.clearInterval(flusher);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
    };
  }, [flush, noPainel]);

  // Uma tela vista por navegação.
  useEffect(() => {
    if (!pathname || noPainel) return;
    screenViewsRef.current += 1;
    track("SCREEN_VIEW", { entityType: "rota", entityId: pathname });
  }, [noPainel, pathname, track]);

  // Instalação do PWA.
  useEffect(() => {
    const onInstalled = () => track("PWA_INSTALLED");
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [track]);

  const api = useMemo<TelemetryApi>(
    () => ({ track, sessionId: () => sessionRef.current }),
    [track],
  );

  return (
    <TelemetryContext.Provider value={api}>{children}</TelemetryContext.Provider>
  );
}

export function useTelemetry(): TelemetryApi {
  return useContext(TelemetryContext);
}
