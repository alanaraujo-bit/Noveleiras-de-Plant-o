"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import { avisarAbaReativada } from "@/lib/shell/aba-reativada";
import {
  IconeBusca,
  IconeCatalogo,
  IconeFeed,
  IconePerfil,
  IconePlantao,
} from "@/components/ui/icones";

/**
 * Barra de abas.
 *
 * A ordem mudou junto com o fluxo: Plantão é a primeira porque é onde o
 * aplicativo abre e onde se assiste. Gêneros saiu da barra — continua a um
 * toque dentro do Catálogo, e cinco destinos já é o teto do que se alcança com
 * o polegar sem olhar.
 *
 * Sobre o reel a barra fica sem fundo: uma faixa opaca cortando o rodapé de um
 * vídeo em tela cheia devolve a moldura de site que o reel existe para tirar.
 *
 * Tocar na aba em que já se está não navega: avisa a tela, que decide o que
 * fazer. Navegar para a rota atual não produz efeito nenhum no roteador, e a
 * pessoa ficaria com a impressão de um botão morto.
 */

const ABAS = [
  { href: "/plantao", rotulo: "Plantão", Icone: IconePlantao },
  { href: "/inicio", rotulo: "Catálogo", Icone: IconeCatalogo },
  { href: "/buscar", rotulo: "Buscar", Icone: IconeBusca },
  { href: "/feed", rotulo: "Comunidade", Icone: IconeFeed },
  { href: "/perfil", rotulo: "Perfil", Icone: IconePerfil },
] as const;

export function BarraAbas() {
  const pathname = usePathname();
  const sobreReel = pathname === "/plantao" || pathname.startsWith("/plantao/");

  return (
    <nav
      aria-label="Navegação principal"
      className={`fixed inset-x-0 bottom-0 z-50 transition-colors duration-300 ${
        sobreReel
          ? "border-t border-transparent bg-gradient-to-t from-black/70 to-transparent"
          : "border-t border-white/8 bg-ink-950/88 backdrop-blur-xl"
      }`}
      style={{ paddingBottom: "var(--safe-b)" }}
    >
      <ul className="mx-auto flex h-[var(--tabbar-h)] max-w-lg items-stretch">
        {ABAS.map(({ href, rotulo, Icone }) => {
          const ativo = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                onClick={(evento) => {
                  if (!ativo) return;
                  evento.preventDefault();
                  avisarAbaReativada(href);
                }}
                className="relative flex h-full flex-col items-center justify-center gap-1 pt-1.5 outline-offset-[-6px]"
              >
                {ativo && !sobreReel ? (
                  <motion.span
                    layoutId="aba-ativa"
                    transition={{ type: "spring", stiffness: 520, damping: 38 }}
                    className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-rose-500"
                  />
                ) : null}
                <span
                  className={`transition-colors duration-200 ${
                    ativo
                      ? sobreReel
                        ? "text-white"
                        : "text-rose-400"
                      : sobreReel
                        ? "text-white/55"
                        : "text-cream-600"
                  } ${sobreReel ? "drop-shadow-[0_1px_3px_rgb(0_0_0/0.6)]" : ""}`}
                >
                  <Icone tamanho={ativo ? 23 : 22} />
                </span>
                <span
                  className={`text-[0.6875rem] font-semibold tracking-tight transition-colors duration-200 ${
                    ativo
                      ? sobreReel
                        ? "text-white"
                        : "text-cream-50"
                      : sobreReel
                        ? "text-white/55"
                        : "text-cream-600"
                  } ${sobreReel ? "[text-shadow:0_1px_3px_rgb(0_0_0/0.6)]" : ""}`}
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
