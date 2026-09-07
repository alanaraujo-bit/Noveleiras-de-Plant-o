"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";

/** Avisos curtos, no rodapé, acima da barra de abas. */

type Toast = {
  id: number;
  message: string;
  tone: "neutro" | "bom" | "ruim";
};

type ToastApi = {
  show: (message: string, tone?: Toast["tone"]) => void;
};

const ToastContext = createContext<ToastApi>({ show: () => {} });

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Toast["tone"] = "neutro") => {
    counter += 1;
    const id = counter;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-5"
        style={{ bottom: "calc(var(--tabbar-h) + var(--safe-b) + 0.75rem)" }}
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 460, damping: 34 }}
              className="pointer-events-auto max-w-sm rounded-full border border-white/10 bg-ink-800/95 px-4 py-2.5 text-center text-sm font-medium text-cream-50 shadow-lift backdrop-blur-sm"
            >
              <span
                className="mr-2 inline-block size-1.5 -translate-y-px rounded-full align-middle"
                style={{
                  background:
                    toast.tone === "bom"
                      ? "var(--color-jade-400)"
                      : toast.tone === "ruim"
                        ? "var(--color-rose-400)"
                        : "var(--color-gold-400)",
                }}
              />
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
