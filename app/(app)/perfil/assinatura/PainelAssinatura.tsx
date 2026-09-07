"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { alternarPlano } from "@/lib/actions/conta";
import { useToast } from "@/components/sistema/ToastProvider";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { IconeCheck } from "@/components/ui/icones";
import { formatDate } from "@/lib/format";

/**
 * Assinatura.
 *
 * O estado do plano é real e gravado no banco — o que ainda não existe é a
 * cobrança. Trocar de plano aqui exercita de ponta a ponta o mesmo caminho que
 * um provedor de pagamento vai acionar depois, então dizemos isso na tela em
 * vez de fingir um checkout.
 */

const BENEFICIOS_PREMIUM = [
  "Catálogo inteiro liberado, sem espera entre episódios",
  "Estreias no mesmo dia em que entram no ar",
  "Sem limite de episódios por novela",
  "Continua de onde parou em qualquer aparelho",
];

const BENEFICIOS_GRATIS = [
  "Novelas gratuitas completas",
  "Primeiros episódios das novelas premium",
  "Minha lista, histórico e progresso",
  "Plantão da comunidade",
];

export function PainelAssinatura({
  plano,
  premium,
  episodiosGratis,
  renovaEm,
}: {
  plano: "FREE" | "PREMIUM" | "VIP";
  premium: boolean;
  episodiosGratis: number;
  renovaEm: string | null;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [processando, iniciar] = useTransition();

  const trocar = (destino: "FREE" | "PREMIUM") => {
    track("PAYWALL_CTA", { payload: { destino } });
    iniciar(async () => {
      await alternarPlano(destino);
      show(
        destino === "PREMIUM"
          ? "Premium ativado nesta conta"
          : "Você voltou ao plano gratuito",
        destino === "PREMIUM" ? "bom" : "neutro",
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 px-5 pb-4">
      <section
        className="warm-glow overflow-hidden rounded-panel border p-5"
        style={{
          borderColor: premium
            ? "rgb(233 189 120 / 0.3)"
            : "rgb(255 255 255 / 0.1)",
          background: premium
            ? "linear-gradient(160deg, rgb(217 163 85 / 0.18), rgb(42 21 35 / 0.9))"
            : "linear-gradient(160deg, rgb(255 255 255 / 0.05), rgb(42 21 35 / 0.6))",
        }}
      >
        <p className="eyebrow">
          {premium ? "Seu plano atual" : "Recomendado para maratonar"}
        </p>
        <h2 className="mt-1.5 text-[1.625rem] leading-tight">Plantão Premium</h2>
        <p className="mt-1.5 text-[0.9375rem] text-cream-200">
          <span className="font-display text-[1.75rem] font-semibold text-cream-50">
            R$ 19,90
          </span>{" "}
          por mês
        </p>

        <ul className="mt-4 space-y-2">
          {BENEFICIOS_PREMIUM.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-gold-400/20 text-gold-300">
                <IconeCheck tamanho={12} />
              </span>
              <span className="text-[0.875rem] leading-snug text-cream-200">
                {item}
              </span>
            </li>
          ))}
        </ul>

        {premium ? (
          <div className="mt-5">
            {renovaEm ? (
              <p className="mb-3 text-[0.8125rem] text-cream-400">
                Ativo até {formatDate(renovaEm)}.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => trocar("FREE")}
              disabled={processando}
              className="tap flex h-12 w-full items-center justify-center rounded-2xl border border-white/14 bg-white/6 text-[0.9375rem] font-semibold text-cream-200 disabled:opacity-50"
            >
              Voltar ao plano gratuito
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => trocar("PREMIUM")}
            disabled={processando}
            className="tap mt-5 flex h-13 w-full items-center justify-center rounded-2xl bg-gold-400 text-[0.9375rem] font-bold text-ink-950 disabled:opacity-60"
          >
            {processando ? "Ativando…" : "Ativar Premium"}
          </button>
        )}
      </section>

      <section className="rounded-panel border border-white/9 bg-white/[0.025] p-5">
        <p className="eyebrow">{plano === "FREE" ? "Seu plano atual" : "Alternativa"}</p>
        <h2 className="mt-1.5 text-[1.25rem] leading-tight">Plantão Gratuito</h2>
        <p className="mt-1 text-[0.875rem] text-cream-400">
          Sem custo, sem cartão. Você vê os {episodiosGratis} primeiros episódios
          de cada novela premium.
        </p>
        <ul className="mt-3.5 space-y-2">
          {BENEFICIOS_GRATIS.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/8 text-cream-400">
                <IconeCheck tamanho={12} />
              </span>
              <span className="text-[0.875rem] leading-snug text-cream-400">
                {item}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="px-2 text-center text-[0.75rem] leading-relaxed text-cream-600">
        A troca de plano é imediata e ainda não há cobrança: nenhum provedor de pagamento está conectado.
        O ponto de integração com o provedor de pagamento já está preparado no
        produto.
      </p>
    </div>
  );
}
