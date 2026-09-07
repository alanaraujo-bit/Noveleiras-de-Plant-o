"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import {
  IconeBusca,
  IconeCasa,
  IconeFeed,
  IconeGeneros,
  IconePerfil,
} from "@/components/ui/icones";

const ABAS = [
  { href: "/inicio", rotulo: "Início", Icone: IconeCasa },
  { href: "/buscar", rotulo: "Buscar", Icone: IconeBusca },
  { href: "/generos", rotulo: "Gêneros", Icone: IconeGeneros },
  { href: "/feed", rotulo: "Plantão", Icone: IconeFeed },
  { href: "/perfil", rotulo: "Perfil", Icone: IconePerfil },
] as const;

export function BarraAbas() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-ink-950/88 backdrop-blur-xl"
      style={{ paddingBottom: "var(--safe-b)" }}
    >
      <ul className="mx-auto flex h-[var(--tabbar-h)] max-w-lg items-stretch">
        {ABAS.map(({ href, rotulo, Icone }) => {
          const ativo =
            pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                className="relative flex h-full flex-col items-center justify-center gap-1 pt-1.5 outline-offset-[-6px]"
              >
                {ativo ? (
                  <motion.span
                    layoutId="aba-ativa"
                    transition={{ type: "spring", stiffness: 520, damping: 38 }}
                    className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-rose-500"
                  />
                ) : null}
                <span
                  className={`transition-colors duration-200 ${
                    ativo ? "text-rose-400" : "text-cream-600"
                  }`}
                >
                  <Icone tamanho={ativo ? 23 : 22} />
                </span>
                <span
                  className={`text-[0.6875rem] font-semibold tracking-tight transition-colors duration-200 ${
                    ativo ? "text-cream-50" : "text-cream-600"
                  }`}
                >
                  {rotulo}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
