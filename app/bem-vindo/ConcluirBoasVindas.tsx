"use client";

import { useState, useTransition } from "react";

import {
  CampoDeHandle,
  handleProntoParaSalvar,
  type EstadoDoHandle,
} from "@/components/perfil/CampoDeHandle";
import { Avatar } from "@/components/ui/primitivos";
import { concluirOnboarding } from "@/lib/actions/conta";
import { NOME_MAX, normalizarHandle } from "@/lib/auth/identidade";

/**
 * Último passo depois de entrar pelo Google.
 *
 * O Google entrega o nome do jeito que a pessoa escreveu lá — às vezes em
 * maiúsculas, às vezes com apelido de 2009. Aqui ela confirma como quer
 * aparecer nos comentários, com o nome já arrumado e um @ sugerido, e vê o
 * resultado antes de seguir.
 */
export function ConcluirBoasVindas({
  nome: nomeInicial,
  handle: handleInicial,
  avatarSeed,
  avatarUrl,
  destino,
}: {
  nome: string;
  handle: string;
  avatarSeed: string;
  avatarUrl: string | null;
  destino: string | null;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [handle, setHandle] = useState(handleInicial);
  const [estadoHandle, setEstadoHandle] = useState<EstadoDoHandle>("seu");
  const [erro, setErro] = useState<{ texto: string; campo?: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  const pronto = nome.trim().length >= 2 && handleProntoParaSalvar(estadoHandle);

  const enviar = () =>
    iniciar(async () => {
      setErro(null);
      const resposta = await concluirOnboarding({ nome, handle, destino });
      // Deu certo = redirecionou. Só volta para cá quando algo precisa de ajuste.
      if (resposta?.erro) setErro({ texto: resposta.erro, campo: resposta.campo });
    });

  return (
    <main
      className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-end px-6 pb-8"
      style={{ paddingBottom: "calc(var(--safe-b) + 2rem)" }}
    >
      <p className="eyebrow">Quase lá</p>
      <h1 className="mt-2.5 text-[2.125rem] leading-[1.06] text-balance-pt">
        Como você quer aparecer?
      </h1>
      <p className="mt-3 max-w-[24rem] text-[0.9375rem] leading-relaxed text-cream-200">
        É assim que as outras noveleiras vão te ver nos comentários. Deixamos
        uma sugestão — ajuste se quiser.
      </p>

      <form
        className="mt-7 space-y-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (pronto && !pendente) enviar();
        }}
      >
        <div>
          <label
            htmlFor="bv-nome"
            className="mb-1.5 block text-[0.75rem] font-semibold text-cream-400"
          >
            Seu nome
          </label>
          <input
            id="bv-nome"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={NOME_MAX}
            autoComplete="name"
            aria-invalid={erro?.campo === "nome"}
            className="h-12 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-[0.9375rem] text-cream-50 outline-none focus:border-rose-500/60"
          />
        </div>

        <div>
          <label
            htmlFor="bv-handle"
            className="mb-1.5 block text-[0.75rem] font-semibold text-cream-400"
          >
            Nome de usuário
          </label>
          <CampoDeHandle
            id="bv-handle"
            valor={handle}
            atual={handleInicial}
            aoMudar={setHandle}
            aoEstado={setEstadoHandle}
            grande
          />
        </div>

        {/* Prévia: o nome e o @ como aparecem num comentário. */}
        <div className="surface-card flex items-center gap-3 rounded-2xl p-3">
          <Avatar nome={nome.trim() || "N"} seed={avatarSeed} fotoUrl={avatarUrl} tamanho={40} />
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold text-cream-50">
              {nome.trim() || "Seu nome"}
            </p>
            <p className="truncate text-[0.8125rem] text-cream-600">
              @{normalizarHandle(handle) || "usuario"}
            </p>
          </div>
        </div>

        {erro ? (
          <p role="alert" className="text-[0.8125rem] leading-snug text-rose-300">
            {erro.texto}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!pronto || pendente}
          className="tap flex h-13 w-full items-center justify-center rounded-2xl bg-cream-50 text-[0.9375rem] font-bold tracking-tight text-ink-950 disabled:opacity-60"
        >
          {pendente ? "Abrindo o Plantão…" : "Ir para o Plantão"}
        </button>
        <p className="text-center text-[0.75rem] text-cream-600">
          Dá para mudar depois em Perfil → Preferências.
        </p>
      </form>
    </main>
  );
}
