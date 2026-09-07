"use client";

import { useEffect, useState } from "react";

import { useToast } from "@/components/sistema/ToastProvider";
import { IconeInstalar } from "@/components/ui/icones";

type PromptInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Instalação do PWA.
 *
 * No Android/desktop usamos o convite do próprio navegador. No iOS não existe
 * esse convite — então explicamos o caminho em vez de mostrar um botão que não
 * faz nada.
 */
export function BotaoInstalar() {
  const { show } = useToast();
  const [convite, setConvite] = useState<PromptInstalacao | null>(null);
  const [instalado, setInstalado] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const emStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalado(emStandalone);
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window),
    );

    const aoConvidar = (evento: Event) => {
      evento.preventDefault();
      setConvite(evento as PromptInstalacao);
    };
    window.addEventListener("beforeinstallprompt", aoConvidar);
    window.addEventListener("appinstalled", () => setInstalado(true));
    return () => window.removeEventListener("beforeinstallprompt", aoConvidar);
  }, []);

  if (instalado) {
    return (
      <p className="rounded-2xl border border-jade-400/20 bg-jade-400/8 px-4 py-3 text-center text-[0.8125rem] font-semibold text-jade-400">
        Aplicativo instalado neste aparelho
      </p>
    );
  }

  if (ios && !convite) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-cream-50">
          <IconeInstalar tamanho={18} />
          Instalar no iPhone
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-cream-400">
          Toque em Compartilhar na barra do Safari e escolha “Adicionar à Tela de
          Início”. O Plantão passa a abrir como aplicativo, em tela cheia.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!convite}
      onClick={async () => {
        if (!convite) return;
        await convite.prompt();
        const escolha = await convite.userChoice;
        if (escolha.outcome === "accepted") {
          show("Instalando o Plantão…", "bom");
          setInstalado(true);
        }
        setConvite(null);
      }}
      className="tap flex h-13 w-full items-center justify-center gap-2 rounded-2xl border border-gold-400/25 bg-gold-400/10 text-[0.9375rem] font-bold text-gold-300 disabled:opacity-45"
    >
      <IconeInstalar tamanho={18} />
      {convite ? "Instalar aplicativo" : "Instalação indisponível aqui"}
    </button>
  );
}
