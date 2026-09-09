"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { useToast } from "@/components/sistema/ToastProvider";
import { Botao, BotaoLink } from "@/components/ui/primitivos";

/**
 * Paywall da página da novela.
 *
 * Aparece quando a pessoa já passou dos episódios gratuitos daquela obra —
 * ou seja, quando ela já se interessou o bastante para chegar até aqui. As
 * duas saídas são oferecidas lado a lado de propósito:
 *
 * - **Comprar esta novela** é a oferta mais barata e a que atende quem só
 *   quer terminar *esta* história. Empurrar assinatura para essa pessoa
 *   costuma resultar em cancelamento no mês seguinte.
 * - **Assinar** é a oferta melhor para quem lê várias, e o texto diz
 *   exatamente a partir de quantas novelas ela compensa — em vez de esconder
 *   a conta.
 */

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function Desbloquear({
  novelaId,
  novelaTitulo,
  novelaSlug,
  precoAvulsoCents,
  precoMensalCents,
  episodiosGratis,
  totalEpisodios,
}: {
  novelaId: string;
  novelaTitulo: string;
  novelaSlug: string;
  precoAvulsoCents: number;
  precoMensalCents: number;
  episodiosGratis: number;
  totalEpisodios: number;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [comprando, setComprando] = useState(false);

  const restantes = Math.max(totalEpisodios - episodiosGratis, 0);

  async function comprar() {
    setComprando(true);
    track("PAYWALL_CTA", { novelaId, payload: { tipo: "compra" } });

    try {
      const resposta = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Preço não viaja: o servidor resolve pelo id da obra.
        body: JSON.stringify({ tipo: "compra", novelaId, metodo: "CARD" }),
      });

      const dados = await resposta.json();

      if (resposta.status === 409) {
        // Já comprou noutra aba ou noutro aparelho. Recarregar mostra liberado.
        show("Você já tem esta novela.", "bom");
        router.refresh();
        return;
      }

      if (!resposta.ok) {
        show(dados.erro ?? "Não foi possível continuar.", "ruim");
        setComprando(false);
        return;
      }

      router.push(
        `/pagamento/${dados.attemptId}?destino=${encodeURIComponent(`/novela/${novelaSlug}`)}`,
      );
    } catch {
      show("Sem conexão com o servidor.", "ruim");
      setComprando(false);
    }
  }

  return (
    <section id="desbloquear" className="scroll-mt-20 px-5 pt-8">
      <div
        className="overflow-hidden rounded-3xl border border-gold-400/22 p-5"
        style={{
          background:
            "linear-gradient(165deg, rgb(217 163 85 / 0.13), rgb(42 21 35 / 0.9))",
        }}
      >
        <p className="eyebrow">
          Você viu os {episodiosGratis} gratuitos
        </p>
        <h2 className="mt-1 text-[1.25rem] leading-tight">
          Faltam {restantes} episódios de {novelaTitulo}
        </h2>

        <div className="mt-5 space-y-2.5">
          <div className="rounded-2xl border border-white/12 bg-black/25 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[0.9375rem] font-semibold text-cream-50">
                Só esta novela
              </p>
              <p className="text-[1.125rem] font-bold text-gold-300">
                {reais(precoAvulsoCents)}
              </p>
            </div>
            <p className="mt-1 text-[0.8125rem] leading-snug text-cream-400">
              Pagamento único. É sua para sempre, inclusive os episódios que
              entrarem depois — mesmo sem assinatura.
            </p>
            <Botao
              variante="ouro"
              largura="cheia"
              className="mt-3.5"
              disabled={comprando}
              onClick={comprar}
            >
              {comprando ? "Abrindo pagamento…" : "Comprar esta novela"}
            </Botao>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[0.9375rem] font-semibold text-cream-50">
                Catálogo inteiro
              </p>
              <p className="text-[1.125rem] font-bold text-rose-300">
                {reais(precoMensalCents)}
                <span className="text-[0.75rem] font-normal text-cream-600">
                  /mês
                </span>
              </p>
            </div>
            <p className="mt-1 text-[0.8125rem] leading-snug text-cream-400">
              Compensa a partir de {Math.ceil(precoMensalCents / precoAvulsoCents) + 1}{" "}
              novelas por mês. Cancele quando quiser.
            </p>
            <BotaoLink
              href={`/planos?destino=${encodeURIComponent(`/novela/${novelaSlug}`)}`}
              variante="secundario"
              largura="cheia"
              className="mt-3.5"
            >
              Ver planos
            </BotaoLink>
          </div>
        </div>
      </div>
    </section>
  );
}
