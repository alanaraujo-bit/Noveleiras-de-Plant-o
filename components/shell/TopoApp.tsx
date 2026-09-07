"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui/primitivos";
import { IconeBusca, IconeMarca } from "@/components/ui/icones";

/**
 * Topo da Home. Fica translúcido só depois que a pessoa rola — em repouso,
 * o conteúdo encosta no topo como em aplicativo nativo.
 */
function saudacaoDaHora(hora: number): string {
  if (hora < 5) return "Boa madrugada";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export function TopoApp({
  nome,
  avatarSeed,
}: {
  nome: string;
  avatarSeed: string;
}) {
  const [rolou, setRolou] = useState(false);
  // A saudação depende do relógio de quem está assistindo, não do servidor.
  const [saudacao, setSaudacao] = useState("Bom te ver");

  useEffect(() => {
    setSaudacao(saudacaoDaHora(new Date().getHours()));
  }, []);

  useEffect(() => {
    const onScroll = () => setRolou(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        rolou
          ? "border-b border-white/8 bg-ink-950/85 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
      style={{ paddingTop: "var(--safe-t)" }}
    >
      <div className="flex items-center gap-3 px-5 py-3">
        <Link
          href="/inicio"
          className="flex min-w-0 items-center gap-2.5"
          aria-label="Noveleiras de Plantão, início"
        >
          <span className="text-rose-500">
            <IconeMarca tamanho={26} />
          </span>
          <span className="min-w-0">
            {/* Título da Home: o nome do produto. Fica em h1 para a página ter
                um cabeçalho principal, sem mudar a aparência. */}
            <h1 className="block truncate font-display text-[0.9375rem] font-semibold leading-tight text-cream-50">
              Noveleiras de Plantão
            </h1>
            <span className="block truncate text-[0.6875rem] font-medium text-cream-600">
              {saudacao}, {nome.split(" ")[0]}
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/buscar"
            aria-label="Buscar novelas"
            className="tap grid size-10 place-items-center rounded-full text-cream-200 hover:bg-white/8"
          >
            <IconeBusca tamanho={21} />
          </Link>
          <Link href="/perfil" aria-label="Sua conta" className="tap p-0.5">
            <Avatar nome={nome} seed={avatarSeed} tamanho={34} />
          </Link>
        </div>
      </div>
    </header>
  );
}
