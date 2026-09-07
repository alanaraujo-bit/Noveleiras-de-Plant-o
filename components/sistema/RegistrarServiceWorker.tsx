"use client";

import { useEffect } from "react";

/**
 * Registra o service worker. Fora de produção não registramos, para não
 * servir versão antiga durante o desenvolvimento.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const registrar = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* sem service worker o app segue funcionando normalmente */
      });
    };

    if (document.readyState === "complete") registrar();
    else window.addEventListener("load", registrar, { once: true });
  }, []);

  return null;
}
