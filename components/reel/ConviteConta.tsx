"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconeFechar, IconeCoracaoCheio } from "@/components/ui/icones";
import { EVENTO_VISITANTE } from "@/lib/player/visitante";

export const PEDIR_CONTA = "nvl:pedir-conta";
type Motivo = "progresso" | "curtir" | "conversa" | "limite";
const LEMBRETE = "nvl:convite:ultimo";
const TEXTOS: Record<Motivo, { titulo: string; texto: string }> = {
  progresso: { titulo: "Sua novela espera por você", texto: "Crie sua conta grátis para guardar onde parou, montar sua lista e levar suas histórias para outro aparelho." },
  curtir: { titulo: "Tem história que ganha a gente", texto: "Com uma conta grátis, você pode curtir os episódios que ama e guardar seu lugar na novela." },
  conversa: { titulo: "Essa cena merece uma conversa", texto: "Crie sua conta grátis para comentar as reviravoltas, responder outras fãs e guardar seu progresso." },
  limite: { titulo: "Quer descobrir o que vem depois?", texto: "Você chegou aos capítulos pagos. Crie sua conta grátis para conhecer as opções de assinatura ou compra. Criar a conta não gera cobrança nem libera os capítulos pagos." },
};

export function ConviteConta({ episodioId, titulo, suspenso, aoAbrir }: {
  episodioId: string;
  titulo: string;
  suspenso: boolean;
  aoAbrir: (aberta: boolean) => void;
}) {
  const reduzir = useReducedMotion();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  const [lembrete, setLembrete] = useState(false);
  const destino = `/plantao?episodio=${encodeURIComponent(episodioId)}`;
  const query = `?destino=${encodeURIComponent(destino)}`;
  const marcarVisto = useCallback(() => {
    try { localStorage.setItem(LEMBRETE, String(Date.now())); } catch { /* opcional */ }
    setLembrete(false);
  }, []);
  const fechar = useCallback(() => { setMotivo(null); marcarVisto(); }, [marcarVisto]);

  useEffect(() => {
    let assistido = 0;
    let mostrado = false;
    const assistir = (e: Event) => {
      if (document.hidden || suspenso || mostrado) return;
      const delta = (e as CustomEvent).detail?.deltaMs;
      if (!Number.isFinite(delta) || delta <= 0) return;
      assistido += Math.min(delta, 15000);
      let ultimo = 0;
      try { ultimo = Number(localStorage.getItem(LEMBRETE)) || 0; } catch { /* opcional */ }
      if (assistido < 35000 || Date.now() - ultimo < 86400000) return;
      mostrado = true;
      try { localStorage.setItem(LEMBRETE, String(Date.now())); } catch { /* opcional */ }
      setLembrete(true);
    };
    window.addEventListener(EVENTO_VISITANTE, assistir);
    return () => window.removeEventListener(EVENTO_VISITANTE, assistir);
  }, [suspenso]);

  useEffect(() => {
    const pedir = (e: Event) => {
      const m = (e as CustomEvent).detail as Motivo;
      if (Object.hasOwn(TEXTOS, m)) { marcarVisto(); setMotivo(m); }
    };
    window.addEventListener(PEDIR_CONTA, pedir);
    return () => window.removeEventListener(PEDIR_CONTA, pedir);
  }, [marcarVisto]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!motivo || !dialog) return;
    const anterior = document.activeElement as HTMLElement | null;
    dialog.showModal();
    aoAbrir(true);
    return () => { dialog.close(); aoAbrir(false); anterior?.focus(); };
  }, [motivo, aoAbrir]);

  return <>
    {!suspenso && !motivo && <button type="button" onClick={() => setMotivo("progresso")}
      className="fixed right-4 z-[60] min-h-11 rounded-full bg-black/75 px-4 text-sm font-semibold text-white"
      style={{ top: "calc(var(--safe-t) + 0.75rem)" }}>Salvar meu lugar</button>}
    <AnimatePresence>
      {lembrete && !suspenso && !motivo && <motion.aside
        initial={{ opacity: 0, y: reduzir ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: reduzir ? 0 : 0.25 }} aria-label="Guardar seu progresso"
        className="fixed inset-x-4 z-[65] mx-auto max-w-md rounded-2xl border border-white/15 bg-ink-850 p-4 text-cream-50 shadow-lg"
        style={{ bottom: "calc(var(--tabbar-h) + var(--safe-b) + 1rem)" }}>
        <button onClick={marcarVisto} aria-label="Dispensar convite" className="absolute right-1 top-1 grid size-11 place-items-center"><IconeFechar tamanho={18} /></button>
        <p className="pr-9 font-semibold">Já se apegou à história?</p>
        <p className="mt-1 pr-5 text-sm text-cream-200">Guarde seu lugar para continuar depois.</p>
        <button className="mt-3 min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold" onClick={() => { marcarVisto(); setMotivo("progresso"); }}>Salvar com uma conta grátis</button>
        <button className="mt-1 block min-h-11 text-sm text-cream-200" onClick={marcarVisto}>Agora quero assistir</button>
      </motion.aside>}
    </AnimatePresence>
    {motivo && <dialog ref={dialogRef} onCancel={fechar} onClick={(e) => { if (e.target === e.currentTarget) fechar(); }}
      aria-labelledby="convite-titulo" aria-describedby="convite-texto"
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto bg-transparent p-0 text-cream-50 backdrop:bg-black/55">
      <motion.div initial={{ y: reduzir ? 0 : 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: reduzir ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto max-w-lg rounded-t-3xl bg-ink-850 px-6 pt-7"
        style={{ paddingBottom: "calc(var(--safe-b) + 1.5rem)" }}>
        <button onClick={fechar} aria-label="Fechar e voltar à novela" className="absolute right-3 top-3 grid size-11 place-items-center rounded-full hover:bg-white/10"><IconeFechar tamanho={21} /></button>
        <span className="mb-4 inline-flex text-rose-400" aria-hidden><IconeCoracaoCheio tamanho={30} /></span>
        <h2 id="convite-titulo" className="max-w-sm pr-6 font-display text-3xl leading-tight">{TEXTOS[motivo].titulo}</h2>
        <p id="convite-texto" className="mt-3 text-[0.9375rem] leading-relaxed text-cream-200">{TEXTOS[motivo].texto}</p>
        <p className="mt-4 truncate text-sm text-cream-200">Você volta para: <strong>{titulo}</strong></p>
        <Link href={`/criar-conta${query}`} className="mt-6 flex min-h-13 items-center justify-center rounded-2xl bg-rose-600 px-4 font-bold text-white">Criar minha conta grátis</Link>
        <Link href={`/entrar${query}`} className="mt-2 flex min-h-12 items-center justify-center rounded-2xl border border-white/20 px-4 font-semibold">Já tenho conta</Link>
        {motivo === "limite" ? <Link href="/plantao?episodio=" className="mt-2 flex min-h-12 items-center justify-center text-sm text-cream-200" onClick={fechar}>Explorar outras novelas gratuitas</Link> : <button onClick={fechar} className="mt-2 min-h-12 w-full text-sm text-cream-200">Continuar assistindo sem conta</button>}
        <p className="mt-2 text-center text-xs leading-relaxed text-cream-200">Conta gratuita, sem cartão. Você escolhe se quer assinar depois.</p>
      </motion.div>
    </dialog>}
  </>;
}
