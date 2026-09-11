"use client";

import Link from "next/link";
import { useActionState } from "react";

import { entrar } from "@/lib/actions/conta";
import {
  BotaoEnviar,
  BotaoGoogle,
  Campo,
  MolduraConta,
} from "@/components/conta/campos";

const ERROS_GOOGLE: Record<string, string> = {
  configuracao: "O acesso pelo Google está quase pronto e ainda precisa das credenciais do projeto.",
  cancelado: "Tudo bem, o acesso pelo Google foi cancelado.",
  sessao: "O acesso pelo Google expirou. Tente novamente.",
  resposta: "O Google não conseguiu concluir o acesso. Tente novamente.",
  identidade: "Não foi possível confirmar esse e-mail do Google.",
  vinculo: "Este e-mail já está ligado a outra conta Google.",
  indisponivel: "Esta conta está indisponível. Fale com o suporte.",
  erro: "O acesso pelo Google não respondeu. Tente novamente.",
};

export function FormEntrar({ destino, googleErro, googleDisponivel, destaque }: {
  destino?: string;
  googleErro?: string;
  googleDisponivel: boolean;
  destaque?: { imagemUrl: string; etiqueta: string; titulo: string };
}) {
  const [estado, acao, pendente] = useActionState(entrar, null);

  return (
    <MolduraConta
      voltarPara={destino ?? "/plantao"}
      destaque={destaque}
      titulo="Continue a sua história"
      subtitulo="Entre para retomar de onde parou e encontrar sua lista, suas curtidas e conversas em qualquer aparelho."
      rodape={
        <p className="text-center text-[0.875rem] text-cream-400">
          Ainda não tem conta?{" "}
          <Link href={`/criar-conta${destino ? `?destino=${encodeURIComponent(destino)}` : ""}`} className="font-semibold text-rose-400">
            Criar agora
          </Link>
        </p>
      }
    >
      <div>
        {googleDisponivel ? (
          <BotaoGoogle href={`/api/auth/google${destino ? `?destino=${encodeURIComponent(destino)}` : ""}`}>
            Continuar com Google
          </BotaoGoogle>
        ) : (
          <div>
            <BotaoGoogle>
              Continuar com Google
            </BotaoGoogle>
            <p className="mt-2 text-center text-xs leading-relaxed text-cream-400">
              Google disponível assim que as credenciais forem conectadas.
            </p>
          </div>
        )}

        {googleErro && ERROS_GOOGLE[googleErro] ? (
          <p role="status" className="mt-3 rounded-xl bg-gold-400/10 px-3 py-2.5 text-center text-[0.8125rem] leading-relaxed text-gold-300">
            {ERROS_GOOGLE[googleErro]}
          </p>
        ) : null}

        <div className="my-5 flex items-center gap-3 text-[0.6875rem] font-bold uppercase tracking-[0.11em] text-cream-600">
          <span className="h-px flex-1 bg-white/10" />
          ou entre com e-mail
          <span className="h-px flex-1 bg-white/10" />
        </div>

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
          Entrar e voltar para a novela
        </BotaoEnviar>
      </form>
      </div>
    </MolduraConta>
  );
}
