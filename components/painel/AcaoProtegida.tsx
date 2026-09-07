"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { BotaoPainel } from "@/components/painel/primitivos";

/**
 * Confirmação de ação sensível.
 *
 * Modal é quase sempre preguiça, e a maior parte das ações do painel acontece
 * no lugar. Aqui ele se justifica: suspender uma conta, reiniciar um servidor
 * ou apagar mídia são coisas que a pessoa precisa **parar** para fazer, com o
 * foco preso e uma frase que diz o que vai acontecer.
 *
 * Usa `<dialog>` nativo: foco preso, Escape funciona, e o conteúdo escapa de
 * qualquer contêiner com `overflow` — que é onde diálogos caseiros somem.
 *
 * O campo de motivo não é enfeite: ele vai para a auditoria, e é o que
 * transforma "alguém suspendeu essa conta" em "foi suspensa por isto".
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

export function AcaoProtegida({
  rotulo,
  titulo,
  descricao,
  confirmar,
  variante = "sutil",
  perigo,
  pedirMotivo,
  /** Palavra que a pessoa precisa digitar. Reserve para o que não tem volta. */
  palavraDeConfirmacao,
  acao,
  desabilitado,
}: {
  rotulo: string;
  titulo: string;
  descricao: React.ReactNode;
  confirmar: string;
  variante?: "sutil" | "principal" | "perigo" | "fantasma";
  perigo?: boolean;
  pedirMotivo?: boolean;
  palavraDeConfirmacao?: string;
  acao: (motivo?: string) => Promise<ResultadoDaAcao>;
  desabilitado?: boolean;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState("");
  const [digitado, setDigitado] = useState("");
  const [resposta, setResposta] = useState<ResultadoDaAcao | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    if (!resposta?.ok) return;
    // Fecha sozinho quando deu certo; erro permanece à vista para ser lido.
    const timer = window.setTimeout(() => fechar(), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resposta]);

  function abrir() {
    setResposta(null);
    setMotivo("");
    setDigitado("");
    dialogo.current?.showModal();
  }

  function fechar() {
    dialogo.current?.close();
  }

  const liberado =
    !palavraDeConfirmacao ||
    digitado.trim().toLowerCase() === palavraDeConfirmacao.toLowerCase();

  return (
    <>
      <BotaoPainel
        type="button"
        variante={variante}
        onClick={abrir}
        disabled={desabilitado}
      >
        {rotulo}
      </BotaoPainel>

      <dialog
        ref={dialogo}
        onClose={() => setResposta(null)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-[var(--p-linha-forte)] bg-[var(--p-elevado)] p-0 text-[var(--p-texto)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="p-5">
          <h2 className="text-[1rem] font-semibold">{titulo}</h2>
          <div className="mt-2 text-[0.875rem] leading-relaxed text-[var(--p-suave)]">
            {descricao}
          </div>

          {pedirMotivo ? (
            <label className="mt-4 block">
              <span className="mb-1 block text-[0.75rem] text-[var(--p-fraco)]">
                Motivo (fica na auditoria)
              </span>
              <textarea
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                rows={2}
                maxLength={400}
                placeholder="Por que está fazendo isso?"
                className="w-full resize-none rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 py-2 text-[0.8125rem] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none"
              />
            </label>
          ) : null}

          {palavraDeConfirmacao ? (
            <label className="mt-4 block">
              <span className="mb-1 block text-[0.75rem] text-[var(--p-fraco)]">
                Digite <strong className="text-[var(--p-texto)]">{palavraDeConfirmacao}</strong>{" "}
                para liberar
              </span>
              <input
                value={digitado}
                onChange={(evento) => setDigitado(evento.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 py-1.5 text-[0.8125rem] focus:border-[var(--p-acento)] focus:outline-none"
              />
            </label>
          ) : null}

          {resposta ? (
            <p
              role="status"
              className={`mt-4 rounded-lg px-3 py-2 text-[0.8125rem] ${
                resposta.ok
                  ? "bg-[var(--p-bom-fundo)] text-[var(--p-bom)]"
                  : "bg-[var(--p-perigo-fundo)] text-[var(--p-perigo)]"
              }`}
            >
              {resposta.ok ? resposta.mensagem : resposta.erro}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <BotaoPainel type="button" variante="fantasma" onClick={fechar}>
              Cancelar
            </BotaoPainel>
            <BotaoPainel
              type="button"
              variante={perigo ? "perigo" : "principal"}
              disabled={!liberado || pendente}
              onClick={() =>
                iniciar(async () => {
                  setResposta(await acao(motivo.trim() || undefined));
                })
              }
            >
              {pendente ? "Executando…" : confirmar}
            </BotaoPainel>
          </div>
        </div>
      </dialog>
    </>
  );
}
