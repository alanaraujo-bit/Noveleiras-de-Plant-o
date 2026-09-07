"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { IconeMarca, IconeSeta } from "@/components/ui/icones";

/**
 * Apresentação para quem chega sem conta. Três passos curtos, avanço por
 * toque, com a marca sempre visível. Nada de formulário antes da hora.
 */

const PASSOS = [
  {
    eyebrow: "Bem-vinda ao plantão",
    titulo: "Novelas verticais, do jeito que a gente assiste de verdade",
    texto:
      "Episódios de dois minutos, feitos para a tela do celular. Começou na fila do mercado, termina no sofá.",
    motivo: "cortina",
  },
  {
    eyebrow: "Sem perder o fio",
    titulo: "O app guarda onde você parou, até no meio da frase",
    texto:
      "Continuar assistindo, minha lista, histórico e episódios novos avisados. Você só escolhe qual drama viver hoje.",
    motivo: "arcos",
  },
  {
    eyebrow: "Ninguém assiste sozinha",
    titulo: "Tem gente comentando cada reviravolta agora mesmo",
    texto:
      "Teorias, indignação e aquele grito de “eu sabia”. O plantão é onde a novela continua depois do último episódio.",
    motivo: "luas",
  },
] as const;

export function Apresentacao() {
  const [passo, setPasso] = useState(0);
  const atual = PASSOS[passo];
  const ultimo = passo === PASSOS.length - 1;

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden"
      style={{
        paddingTop: "calc(var(--safe-t) + 1.5rem)",
        paddingBottom: "calc(var(--safe-b) + 1.5rem)",
      }}
    >
      {/* Cortina de fundo: a mesma linguagem visual das capas do catálogo. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 70% at 50% -5%, #4a1128 0%, #2a0f1d 42%, #130810 100%)",
          }}
        />
        <motion.div
          key={passo}
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-0 top-0 h-[62%]"
          style={{
            backgroundImage: `url(/api/arte/hero/${
              ["herdeira-do-silencio", "coracao-em-plantao", "sete-dias-de-fevereiro"][
                passo
              ]
            })`,
            backgroundSize: "cover",
            backgroundPosition: "center 20%",
            maskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)",
          }}
        />
      </div>

      <header className="relative flex items-center justify-between px-6">
        <div className="flex items-center gap-2.5 text-cream-50">
          <span className="text-rose-500">
            <IconeMarca tamanho={26} />
          </span>
          <span className="font-display text-[0.9375rem] font-semibold leading-tight">
            Noveleiras
            <br />
            de Plantão
          </span>
        </div>
        {!ultimo ? (
          <button
            type="button"
            onClick={() => setPasso(PASSOS.length - 1)}
            className="tap rounded-full px-3 py-2 text-[0.8125rem] font-semibold text-cream-400"
          >
            Pular
          </button>
        ) : null}
      </header>

      <div className="relative flex flex-1 flex-col justify-end px-6 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={passo}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="eyebrow">{atual.eyebrow}</p>
            <h1 className="mt-2.5 text-[2.125rem] leading-[1.06] text-balance-pt">
              {atual.titulo}
            </h1>
            <p className="selectable mt-3.5 max-w-[24rem] text-[0.9375rem] leading-relaxed text-cream-200">
              {atual.texto}
            </p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-7 flex items-center gap-1.5" aria-hidden>
          {PASSOS.map((item, index) => (
            <span
              key={item.eyebrow}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: index === passo ? "1.5rem" : "0.375rem",
                background:
                  index === passo
                    ? "var(--color-rose-500)"
                    : "rgb(255 255 255 / 0.2)",
              }}
            />
          ))}
        </div>

        <div className="mt-5 space-y-2.5">
          {ultimo ? (
            <>
              <Link
                href="/criar-conta"
                className="tap flex h-13 w-full items-center justify-center rounded-2xl bg-rose-600 text-[0.9375rem] font-bold tracking-tight text-cream-50 shadow-[0_0.5rem_1.75rem_-0.5rem_var(--color-rose-700)]"
              >
                Criar minha conta grátis
              </Link>
              <Link
                href="/entrar"
                className="tap flex h-13 w-full items-center justify-center rounded-2xl border border-white/14 bg-white/6 text-[0.9375rem] font-semibold text-cream-50"
              >
                Já tenho conta
              </Link>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setPasso((current) => current + 1)}
              className="tap flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-cream-50 text-[0.9375rem] font-bold tracking-tight text-ink-950"
            >
              Continuar
              <IconeSeta tamanho={17} />
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
