"use client";

import { useEffect, useRef, useState } from "react";

import { verificarHandle } from "@/lib/actions/conta";
import { HANDLE_MAX, normalizarHandle, validarHandle } from "@/lib/auth/identidade";

/**
 * O campo do @.
 *
 * Responde enquanto a pessoa digita: a regra é conferida na hora, e a
 * disponibilidade logo depois de uma pausa curta. Descobrir que o @ já tem
 * dono só depois de apertar o botão é o que faz alguém desistir no meio.
 */

export type EstadoDoHandle = "seu" | "verificando" | "livre" | "ocupado" | "invalido";

export function handleProntoParaSalvar(estado: EstadoDoHandle): boolean {
  return estado === "seu" || estado === "livre";
}

export function CampoDeHandle({
  id,
  valor,
  atual,
  aoMudar,
  aoEstado,
  grande,
}: {
  id: string;
  valor: string;
  /** O @ que a pessoa já tem — não precisa checar o que já é dela. */
  atual: string;
  aoMudar: (valor: string) => void;
  aoEstado?: (estado: EstadoDoHandle) => void;
  grande?: boolean;
}) {
  const [estado, setEstado] = useState<EstadoDoHandle>("seu");
  const [erro, setErro] = useState<string | null>(null);
  const avisar = useRef(aoEstado);
  avisar.current = aoEstado;

  useEffect(() => {
    const mudar = (novo: EstadoDoHandle, mensagem: string | null = null) => {
      setEstado(novo);
      setErro(mensagem);
      avisar.current?.(novo);
    };

    const handle = normalizarHandle(valor);
    if (handle === atual) {
      mudar("seu");
      return;
    }
    const regra = validarHandle(handle);
    if (!regra.ok) {
      mudar("invalido", regra.erro);
      return;
    }

    mudar("verificando");
    let cancelado = false;
    const espera = window.setTimeout(async () => {
      const resposta = await verificarHandle(handle).catch(() => null);
      if (cancelado) return;
      if (!resposta) mudar("invalido", "Não deu para conferir agora. Tente de novo.");
      else if (resposta.disponivel) mudar("livre");
      else mudar(resposta.erro ? "invalido" : "ocupado", resposta.erro ?? null);
    }, 350);

    return () => {
      cancelado = true;
      window.clearTimeout(espera);
    };
  }, [valor, atual]);

  const handle = normalizarHandle(valor);
  const recado =
    estado === "seu"
      ? { tom: "text-cream-600", texto: handle ? "Este é o seu @ atual." : "" }
      : estado === "verificando"
        ? { tom: "text-cream-600", texto: "Conferindo…" }
        : estado === "livre"
          ? { tom: "text-cream-200", texto: `✓ @${handle} está livre` }
          : estado === "ocupado"
            ? { tom: "text-rose-300", texto: `@${handle} já tem dono. Tente outra variação.` }
            : { tom: "text-rose-300", texto: erro ?? "" };

  return (
    <div>
      <div
        className={`flex items-center rounded-xl border bg-white/[0.04] transition-colors focus-within:border-rose-500/60 ${
          estado === "ocupado" || estado === "invalido" ? "border-rose-400/50" : "border-white/12"
        } ${grande ? "h-12" : "h-11"}`}
      >
        <span aria-hidden className="pl-3 text-[0.9375rem] text-cream-600">
          @
        </span>
        <input
          id={id}
          value={valor}
          onChange={(evento) =>
            aoMudar(evento.target.value.toLowerCase().replace(/\s+/g, "").replace(/^@+/, ""))
          }
          maxLength={HANDLE_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          aria-invalid={estado === "ocupado" || estado === "invalido"}
          aria-describedby={`${id}-recado`}
          className="h-full min-w-0 flex-1 bg-transparent pr-3 pl-0.5 text-[0.9375rem] text-cream-50 outline-none"
        />
      </div>
      <p
        id={`${id}-recado`}
        role="status"
        className={`mt-1.5 min-h-[1.1rem] text-[0.75rem] leading-snug ${recado.tom}`}
      >
        {recado.texto}
      </p>
    </div>
  );
}
