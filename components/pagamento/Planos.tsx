"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";

import {
  ComoPrefereModo,
  type ModoDePagamento,
} from "@/components/pagamento/ComoPrefereModo";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { useToast } from "@/components/sistema/ToastProvider";
import { IconeCheck } from "@/components/ui/icones";
import { Botao } from "@/components/ui/primitivos";

/**
 * Escolha de plano.
 *
 * A comparação é honesta de propósito: o anual mostra o preço cheio **e** o
 * equivalente mensal, e diz quanto economiza em reais. Esconder o valor
 * cheio atrás de "R$ 8,33/mês" é a prática comum e é exatamente o que gera
 * estorno — a pessoa vê R$ 99,90 na fatura e não reconhece a compra.
 */

export type PlanoNaTela = {
  code: "MONTHLY" | "ANNUAL";
  nome: string;
  descricao: string;
  precoCents: number;
  intervalo: "MONTH" | "YEAR";
  beneficios: string[];
  cor: string;
};

export type EstadoAtual = {
  premium: boolean;
  plano: string;
  planoNome: string;
  renovaEm: string | null;
  cancelado: boolean;
  /** Renova à mão: nada será cobrado sozinho quando a data chegar. */
  manual: boolean;
};

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function Planos({
  planos,
  atual,
  gratuitos,
  economiaCents,
  mensalEquivalenteCents,
  destino,
}: {
  planos: PlanoNaTela[];
  atual: EstadoAtual;
  gratuitos: number;
  economiaCents: number;
  mensalEquivalenteCents: number;
  /** Para onde voltar depois de pagar. Preserva a intenção de quem veio do paywall. */
  destino?: string;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [processando, setProcessando] = useState<string | null>(null);
  const [escolhendoModo, setEscolhendoModo] = useState<PlanoNaTela | null>(null);
  const [modoEmCurso, setModoEmCurso] = useState<ModoDePagamento | null>(null);

  /**
   * Mensal pergunta como pagar; anual vai direto ao cartão.
   *
   * O Pix paga um ciclo por vez, e um ciclo anual pago de uma vez é uma decisão
   * comercial que ninguém tomou. Perguntar no anual seria oferecer algo que o
   * servidor recusa — pior que não oferecer.
   */
  async function assinar(plano: PlanoNaTela) {
    if (plano.intervalo === "MONTH") {
      track("PAYWALL_CTA", { payload: { plano: plano.code, etapa: "modo" } });
      setEscolhendoModo(plano);
      return;
    }
    await abrirCobranca(plano, "CARD");
  }

  async function abrirCobranca(plano: PlanoNaTela, metodo: ModoDePagamento) {
    setProcessando(plano.code);
    setModoEmCurso(metodo);
    track("PAYWALL_CTA", { payload: { plano: plano.code, metodo } });

    try {
      const resposta = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Só a escolha viaja. Preço e período são resolvidos no servidor.
        body: JSON.stringify({
          tipo: "assinatura",
          plano: plano.code,
          metodo,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        show(dados.erro ?? "Não foi possível continuar.", "ruim");
        setProcessando(null);
        setModoEmCurso(null);
        return;
      }

      setEscolhendoModo(null);
      const query = destino ? `&destino=${encodeURIComponent(destino)}` : "";
      router.push(`/pagamento/${dados.attemptId}?tipo=assinatura${query}`);
    } catch {
      show("Sem conexão com o servidor.", "ruim");
      setProcessando(null);
      setModoEmCurso(null);
    }
  }

  return (
    <div className="px-5 pb-10">
      {atual.premium ? (
        <div className="mb-6 rounded-2xl border border-gold-400/25 bg-gold-400/8 p-4">
          <p className="text-sm font-semibold text-gold-300">
            {atual.planoNome} ativo
          </p>
          <p className="mt-1 text-[0.8125rem] text-cream-400">
            {/* "Renova em" seria promessa falsa para quem paga por Pix:
                ninguém vai cobrar nada quando a data chegar. */}
            {atual.cancelado
              ? `Cancelado. Você assiste até ${formatarData(atual.renovaEm)}.`
              : !atual.renovaEm
                ? "Catálogo inteiro liberado."
                : atual.manual
                  ? `Vale até ${formatarData(atual.renovaEm)}.`
                  : `Renova em ${formatarData(atual.renovaEm)}.`}
          </p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {planos.map((plano, indice) => {
          const anual = plano.intervalo === "YEAR";
          const destaque = anual;

          return (
            <motion.li
              key={plano.code}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: indice * 0.06, duration: 0.32 }}
              className="relative overflow-hidden rounded-3xl border p-5"
              style={{
                borderColor: destaque ? `${plano.cor}55` : "rgb(255 255 255/0.1)",
                background: destaque
                  ? `linear-gradient(160deg, ${plano.cor}1a, transparent 65%)`
                  : "rgb(255 255 255/0.03)",
              }}
            >
              {destaque ? (
                <span
                  className="absolute right-4 top-4 rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-wider"
                  style={{ background: plano.cor, color: "#1a1016" }}
                >
                  Economiza {reais(economiaCents)}
                </span>
              ) : null}

              <p className="eyebrow" style={{ color: plano.cor }}>
                {anual ? "12 meses" : "Mês a mês"}
              </p>
              <h2 className="mt-0.5 text-[1.25rem] leading-tight">
                {plano.nome}
              </h2>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[2rem] font-bold leading-none tracking-tight">
                  {reais(plano.precoCents)}
                </span>
                <span className="text-[0.8125rem] text-cream-600">
                  {anual ? "por ano" : "por mês"}
                </span>
              </div>

              {anual ? (
                // O equivalente mensal aparece *abaixo* do preço cheio, nunca
                // no lugar dele: quem paga precisa reconhecer o valor que vai
                // aparecer na fatura.
                <p className="mt-1 text-[0.8125rem] text-cream-400">
                  Sai por {reais(mensalEquivalenteCents)} por mês
                </p>
              ) : null}

              <ul className="mt-4 space-y-2">
                {plano.beneficios.map((beneficio) => (
                  <li
                    key={beneficio}
                    className="flex items-start gap-2 text-[0.8125rem] text-cream-200"
                  >
                    <span className="mt-0.5 shrink-0" style={{ color: plano.cor }}>
                      <IconeCheck tamanho={15} />
                    </span>
                    {beneficio}
                  </li>
                ))}
              </ul>

              <Botao
                largura="cheia"
                tamanho="grande"
                variante={destaque ? "ouro" : "principal"}
                className="mt-5"
                disabled={processando !== null}
                onClick={() => assinar(plano)}
              >
                {processando === plano.code
                  ? "Abrindo pagamento…"
                  : // Quem já está no mensal por Pix não "troca" de plano ao
                    // tocar no mensal: renova o que já tem, e o mês novo entra
                    // no fim do atual.
                    atual.premium && atual.manual && !anual
                    ? "Renovar o mensal"
                    : atual.premium
                      ? `Trocar para o ${anual ? "anual" : "mensal"}`
                      : `Assinar ${anual ? "anual" : "mensal"}`}
              </Botao>
            </motion.li>
          );
        })}
      </ul>

      <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <p className="text-sm font-semibold text-cream-50">
          Plantão Gratuito
        </p>
        <p className="mt-1 text-[0.8125rem] text-cream-400">
          Sem cartão e sem prazo: você vê os {gratuitos} primeiros episódios de
          qualquer novela do catálogo. Só o que vem depois do {gratuitos}º pede
          assinatura — ou a compra daquela novela.
        </p>
      </div>

      <p className="mt-5 text-center text-[0.75rem] leading-relaxed text-cream-600">
        Cancele quando quiser, sem multa. Ao cancelar, você continua assistindo
        até o fim do período já pago. Novelas compradas avulso são suas para
        sempre, mesmo sem assinatura.
      </p>

      <ComoPrefereModo
        aberta={escolhendoModo !== null}
        aoFechar={() => {
          // Fechar no meio de uma abertura de cobrança deixaria a pessoa sem
          // saber se a cobrança nasceu. Enquanto o servidor não responde, a
          // folha fica.
          if (processando) return;
          setEscolhendoModo(null);
        }}
        precoCents={escolhendoModo?.precoCents ?? 0}
        processando={modoEmCurso}
        aoEscolher={(metodo) => {
          if (escolhendoModo) void abrirCobranca(escolhendoModo, metodo);
        }}
      />
    </div>
  );
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });
}
