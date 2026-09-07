"use client";

import Link from "next/link";
import { useActionState } from "react";

import { entrar } from "@/lib/actions/conta";
import {
  BotaoEnviar,
  Campo,
  MolduraConta,
} from "@/components/conta/campos";

export function FormEntrar({ destino }: { destino?: string }) {
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
        {/* Para onde voltar depois de entrar. Validado no servidor: so caminho
            interno passa, nunca uma URL de fora. */}
        {destino ? <input type="hidden" name="destino" value={destino} /> : null}
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

    </MolduraConta>
  );
}
