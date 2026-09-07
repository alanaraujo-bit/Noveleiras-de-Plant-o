"use client";

import Link from "next/link";
import { useActionState } from "react";

import { entrar } from "@/lib/actions/conta";
import {
  BotaoEnviar,
  Campo,
  MolduraConta,
} from "@/components/conta/campos";

export function FormEntrar() {
  const [estado, acao, pendente] = useActionState(entrar, null);

  return (
    <MolduraConta
      titulo="Seu plantão estava esperando"
      subtitulo="Entre para retomar de onde parou, com a sua lista e o seu histórico intactos."
      rodape={
        <p className="text-center text-[0.875rem] text-cream-400">
          Ainda não tem conta?{" "}
          <Link href="/criar-conta" className="font-semibold text-rose-400">
            Criar agora
          </Link>
        </p>
      }
    >
      <form action={acao} className="space-y-4">
        <Campo
          rotulo="E-mail"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="voce@email.com"
          required
          erro={estado?.campo === "email" ? estado.erro : null}
        />
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          placeholder="Sua senha"
          required
          erro={estado?.campo === "senha" ? estado.erro : null}
        />

        {estado?.erro && !estado.campo ? (
          <p role="alert" className="text-[0.875rem] text-rose-300">
            {estado.erro}
          </p>
        ) : null}

        <BotaoEnviar pendente={pendente} pendenteTexto="Entrando…">
          Entrar
        </BotaoEnviar>
      </form>

      <div className="mt-7 rounded-card border border-white/8 bg-white/[0.03] p-4">
        <p className="text-[0.75rem] font-bold uppercase tracking-[0.1em] text-gold-400">
          Conta de demonstração
        </p>
        <p className="selectable mt-1.5 text-[0.8125rem] leading-relaxed text-cream-400">
          Para conhecer o app com catálogo, progresso e lista já preenchidos:
          <br />
          <span className="font-semibold text-cream-200">demo@noveleiras.app</span>{" "}
          · senha{" "}
          <span className="font-semibold text-cream-200">plantao123</span>
        </p>
      </div>
    </MolduraConta>
  );
}
