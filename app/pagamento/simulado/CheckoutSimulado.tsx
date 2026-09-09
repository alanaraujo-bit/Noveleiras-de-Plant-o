"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/sistema/ToastProvider";
import { Botao } from "@/components/ui/primitivos";

/**
 * Painel de controle do provedor falso.
 *
 * Deliberadamente **não** se parece com o produto: fundo cru, tipografia de
 * terminal, aviso em cima. Se esta tela parecesse um checkout de verdade,
 * alguém acabaria confundindo uma aprovação simulada com uma cobrança real —
 * e é exatamente esse tipo de confusão que estraga um teste de pagamento.
 */

type Acao = "aprovar" | "recusar" | "reembolsar" | "estornar";

const ACOES: { acao: Acao; rotulo: string; explicacao: string }[] = [
  {
    acao: "aprovar",
    rotulo: "Aprovar pagamento",
    explicacao: "Libera o acesso, como um cartão autorizado faria.",
  },
  {
    acao: "recusar",
    rotulo: "Recusar cartão",
    explicacao: "Nada é liberado e a tentativa fica registrada como recusada.",
  },
  {
    acao: "reembolsar",
    rotulo: "Reembolsar",
    explicacao: "Devolve o valor e revoga o direito concedido.",
  },
  {
    acao: "estornar",
    rotulo: "Chargeback",
    explicacao: "Estorno imposto pelo banco: revoga o acesso e registra o caso.",
  },
];

export function CheckoutSimulado({
  attemptId,
  externalId,
  valorCents,
  tipo,
  status,
  nomeDoItem,
}: {
  attemptId: string;
  externalId: string;
  valorCents: number;
  tipo: "SUBSCRIPTION" | "PURCHASE";
  status: string;
  nomeDoItem: string;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [ocupado, setOcupado] = useState<Acao | null>(null);

  async function executar(acao: Acao) {
    setOcupado(acao);
    try {
      const resposta = await fetch("/api/pagamentos/simular", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao, externalId }),
      });

      if (!resposta.ok) {
        show("O modo de teste não está ativo neste ambiente.", "ruim");
        setOcupado(null);
        return;
      }

      router.push(`/pagamento/${attemptId}`);
    } catch {
      show("Sem conexão com o servidor.", "ruim");
      setOcupado(null);
    }
  }

  return (
    <div
      className="min-h-dvh bg-[#0d0a0c] px-5 font-mono"
      style={{
        paddingTop: "calc(var(--safe-t) + 2rem)",
        paddingBottom: "var(--safe-b)",
      }}
    >
      <div className="mx-auto w-full max-w-sm">
        <div className="rounded-lg border border-gold-400/35 bg-gold-400/8 p-3">
          <p className="text-[0.75rem] font-bold uppercase tracking-wider text-gold-300">
            Provedor simulado
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-cream-400">
            Nenhum dinheiro se move aqui. Esta tela só existe fora de produção e
            serve para exercitar os estados de pagamento antes de o Mercado Pago
            estar ligado.
          </p>
        </div>

        <dl className="mt-6 space-y-2 text-[0.8125rem]">
          <Linha rotulo="Item" valor={nomeDoItem} />
          <Linha
            rotulo="Tipo"
            valor={tipo === "PURCHASE" ? "Compra avulsa" : "Assinatura"}
          />
          <Linha
            rotulo="Valor"
            valor={(valorCents / 100).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          />
          <Linha rotulo="Estado" valor={status} />
          <Linha rotulo="Referência" valor={externalId} />
        </dl>

        <div className="mt-7 space-y-2.5">
          {ACOES.map((item) => (
            <div
              key={item.acao}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
            >
              <Botao
                largura="cheia"
                variante={item.acao === "aprovar" ? "principal" : "secundario"}
                tamanho="pequeno"
                disabled={ocupado !== null}
                onClick={() => executar(item.acao)}
              >
                {ocupado === item.acao ? "Processando…" : item.rotulo}
              </Botao>
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-cream-600">
                {item.explicacao}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => router.push(`/pagamento/${attemptId}`)}
          className="tap mt-6 w-full py-2 text-center text-[0.75rem] text-cream-600 underline underline-offset-4"
        >
          Voltar sem fazer nada
        </button>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/6 pb-2">
      <dt className="shrink-0 text-cream-600">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right text-cream-200">{valor}</dd>
    </div>
  );
}
