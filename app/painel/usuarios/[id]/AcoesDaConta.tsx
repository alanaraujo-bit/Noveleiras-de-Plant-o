"use client";

import { useState, useTransition } from "react";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { BotaoPainel } from "@/components/painel/primitivos";
import {
  alterarAssinatura,
  alterarSituacaoDaConta,
  encerrarSessoesDaConta,
} from "@/lib/painel/acoes/usuarios";
import { PLANOS } from "@/lib/painel/planos";

/**
 * Ações administrativas sobre uma conta.
 *
 * Vive no cliente porque cada botão precisa montar a chamada com os seus
 * próprios argumentos — e função com argumento fechado não atravessa a
 * fronteira servidor→cliente. As ações em si continuam no servidor, e cada
 * uma reconfere a permissão por conta própria: este componente não é
 * autoridade nenhuma, só a mão que aperta o botão.
 */
export function AcoesDaConta({
  userId,
  nome,
  suspensa,
  podeEditar,
  podeMexerNoFinanceiro,
  planoAtual,
  statusAtual,
}: {
  userId: string;
  nome: string;
  suspensa: boolean;
  podeEditar: boolean;
  podeMexerNoFinanceiro: boolean;
  planoAtual: string;
  statusAtual: string;
}) {
  const [plano, setPlano] = useState(planoAtual);
  const [status, setStatus] = useState(statusAtual);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const mudouAssinatura = plano !== planoAtual || status !== statusAtual;

  return (
    <div className="space-y-4">
      {podeEditar ? (
        <div className="flex flex-wrap gap-2">
          {suspensa ? (
            <AcaoProtegida
              rotulo="Reativar conta"
              titulo={`Reativar a conta de ${nome}?`}
              descricao="A pessoa volta a conseguir entrar e usar o aplicativo normalmente."
              confirmar="Reativar"
              pedirMotivo
              acao={(motivo) =>
                alterarSituacaoDaConta({ userId, status: "ACTIVE", motivo })
              }
            />
          ) : (
            <AcaoProtegida
              rotulo="Suspender conta"
              titulo={`Suspender a conta de ${nome}?`}
              descricao={
                <>
                  A pessoa deixa de conseguir entrar e as sessões abertas são
                  encerradas na hora — sem isso ela continuaria dentro do app com
                  o cookie que já tem. Nada é apagado, e dá para reativar depois.
                </>
              }
              confirmar="Suspender"
              variante="perigo"
              perigo
              pedirMotivo
              acao={(motivo) =>
                alterarSituacaoDaConta({ userId, status: "SUSPENDED", motivo })
              }
            />
          )}

          <AcaoProtegida
            rotulo="Encerrar sessões"
            titulo="Encerrar as sessões abertas?"
            descricao="A pessoa precisará entrar de novo nos aparelhos em que estava. Útil quando alguém perde o celular ou suspeita de acesso indevido."
            confirmar="Encerrar"
            acao={() => encerrarSessoesDaConta(userId)}
          />
        </div>
      ) : null}

      {podeMexerNoFinanceiro ? (
        <div className="rounded-lg border border-[var(--p-linha)] p-3">
          <p className="mb-2.5 text-[0.75rem] text-[var(--p-fraco)]">
            Assinatura — a mudança carimba o preço de tabela do plano, para que
            a receita recorrente pare de ser estimada nesta conta.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={plano}
              onChange={(evento) => setPlano(evento.target.value)}
              aria-label="Plano"
              className="h-8 rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)]"
            >
              {Object.values(PLANOS).map((definicao) => (
                <option key={definicao.plano} value={definicao.plano}>
                  {definicao.nome}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(evento) => setStatus(evento.target.value)}
              aria-label="Situação da assinatura"
              className="h-8 rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)]"
            >
              {["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "EXPIRED"].map(
                (valor) => (
                  <option key={valor} value={valor}>
                    {
                      {
                        ACTIVE: "Ativa",
                        TRIALING: "Em teste",
                        PAST_DUE: "Em atraso",
                        CANCELED: "Cancelada",
                        EXPIRED: "Expirada",
                      }[valor]
                    }
                  </option>
                ),
              )}
            </select>
            <BotaoPainel
              variante="principal"
              disabled={!mudouAssinatura || pendente}
              onClick={() =>
                iniciar(async () => {
                  const resultado = await alterarAssinatura({
                    userId,
                    plano: plano as "FREE" | "PREMIUM" | "VIP",
                    status: status as "ACTIVE",
                  });
                  setAviso(resultado.ok ? resultado.mensagem : resultado.erro);
                })
              }
            >
              {pendente ? "Salvando…" : "Salvar assinatura"}
            </BotaoPainel>
            {aviso ? (
              <span role="status" className="text-[0.75rem] text-[var(--p-suave)]">
                {aviso}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {!podeEditar && !podeMexerNoFinanceiro ? (
        <p className="text-[0.8125rem] text-[var(--p-fraco)]">
          Você pode ver esta ficha, mas não alterá-la.
        </p>
      ) : null}
    </div>
  );
}
