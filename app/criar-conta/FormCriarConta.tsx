"use client";

import Link from "next/link";
import { useActionState } from "react";

import { criarConta } from "@/lib/actions/conta";
import { BotaoEnviar, Campo, MolduraConta } from "@/components/conta/campos";

export function FormCriarConta() {
  const [estado, acao, pendente] = useActionState(criarConta, null);

  return (
    <MolduraConta
      titulo="Entre para o plantão"
      subtitulo="Uma conta guarda seu progresso, sua lista e as conversas que você acompanha."
      rodape={
        <p className="text-center text-[0.875rem] text-cream-400">
          Já tem conta?{" "}
          <Link href="/entrar" className="font-semibold text-rose-400">
            Entrar
          </Link>
        </p>
      }
    >
      <form action={acao} className="space-y-4">
        <Campo
          rotulo="Como podemos te chamar?"
          name="nome"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          placeholder="Seu nome"
          required
          maxLength={60}
          erro={estado?.campo === "nome" ? estado.erro : null}
        />
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
          autoComplete="new-password"
          enterKeyHint="go"
          placeholder="Crie uma senha"
          required
          minLength={8}
          dica="Pelo menos 8 caracteres."
          erro={estado?.campo === "senha" ? estado.erro : null}
        />

        {estado?.erro && !estado.campo ? (
          <p role="alert" className="text-[0.875rem] text-rose-300">
            {estado.erro}
          </p>
        ) : null}

        <BotaoEnviar pendente={pendente} pendenteTexto="Criando sua conta…">
          Criar conta grátis
        </BotaoEnviar>

        <p className="pt-1 text-center text-[0.75rem] leading-relaxed text-cream-600">
          Criando a conta você começa no plano gratuito. Sem cobrança, sem
          pedir cartão.
        </p>
      </form>
    </MolduraConta>
  );
}
