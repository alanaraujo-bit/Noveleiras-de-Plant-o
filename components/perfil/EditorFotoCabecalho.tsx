"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { prepararFotoPerfil } from "@/components/perfil/prepararFoto";
import { useToast } from "@/components/sistema/ToastProvider";
import { IconeCamera } from "@/components/ui/icones";
import { Avatar } from "@/components/ui/primitivos";

export function EditorFotoCabecalho({
  nome,
  handle,
  avatarSeed,
  avatarUrl,
}: {
  nome: string;
  handle: string;
  avatarSeed: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const { show } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fotoUrl, setFotoUrl] = useState(avatarUrl);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => setFotoUrl(avatarUrl), [avatarUrl]);

  const enviar = async (original: File) => {
    const anterior = fotoUrl;
    let previa: string | null = null;
    setEnviando(true);
    try {
      const foto = await prepararFotoPerfil(original);
      previa = URL.createObjectURL(foto);
      setFotoUrl(previa);

      const formData = new FormData();
      formData.set("foto", foto);
      const response = await fetch("/api/perfil/avatar", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        ok: boolean;
        avatarUrl?: string;
        message?: string;
      };
      if (!response.ok || !result.ok || !result.avatarUrl) {
        throw new Error(result.message || "Não foi possível salvar a foto.");
      }

      setFotoUrl(result.avatarUrl);
      show("Foto de perfil atualizada", "bom");
      router.refresh();
    } catch (error) {
      setFotoUrl(anterior);
      show(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a foto agora.",
        "ruim",
      );
    } finally {
      if (previa) URL.revokeObjectURL(previa);
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={enviando}
        aria-label={fotoUrl ? "Trocar foto de perfil" : "Adicionar foto de perfil"}
        aria-busy={enviando}
        className="tap relative shrink-0 rounded-full disabled:opacity-70"
      >
        <Avatar
          nome={nome}
          seed={avatarSeed}
          fotoUrl={fotoUrl}
          tamanho={62}
        />
        <span className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border border-ink-950 bg-rose-600 text-cream-50 shadow-lift">
          {enviando ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
          ) : (
            <IconeCamera tamanho={14} />
          )}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void enviar(file);
        }}
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.625rem] leading-tight">{nome}</h1>
        <p className="truncate text-[0.875rem] text-cream-600">@{handle}</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={enviando}
          className="tap mt-1 text-[0.8125rem] font-semibold text-rose-300 disabled:opacity-60"
        >
          {enviando ? "Preparando foto…" : fotoUrl ? "Trocar foto" : "Adicionar foto"}
        </button>
      </div>
    </div>
  );
}
