"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { useToast } from "@/components/sistema/ToastProvider";
import { Botao } from "@/components/ui/primitivos";

/**
 * O lembrete de renovação, e o botão que o resolve no mesmo toque.
 *
 * Três decisões de tom, todas contra o que costuma se fazer aqui:
 *
 * - **Só aparece quando há o que fazer.** Faltando mais de uma semana, não
 *   existe. Quem paga não precisa ser lembrado todo dia de que paga.
 * - **Nada de contagem regressiva, vermelho ou "última chance".** O prazo real
 *   já é a informação; enfeitá-lo de urgência é o caminho mais curto para a
 *   pessoa cancelar por irritação.
 * - **Um botão só.** Renovar é o único desfecho que ela quer; oferecer três
 *   caminhos no meio de um aviso é transformar lembrete em formulário.
 */

export type Momento =
  | "em-dia"
  | "vencendo"
  | "ultimo-dia"
  | "carencia"
  | "encerrado";

export function FaixaDeRenovacao({
  momento,
  titulo,
  detalhe,
  acao,
  compacta = false,
  mostrarEmDia = false,
}: {
  momento: Momento;
  titulo: string;
  detalhe: string;
  acao: string;
  /** No perfil o aviso é uma linha; na tela de assinatura, um bloco. */
  compacta?: boolean;
  /**
   * Mostrar mesmo sem nada a fazer.
   *
   * Ligado só na tela de assinatura: quem entrou ali veio justamente
   * administrar o plano, e esconder o botão de renovar seria esconder a razão
   * da visita. Em qualquer outro lugar, aviso sem urgência é ruído.
   */
  mostrarEmDia?: boolean;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { track } = useTelemetry();
  const [abrindo, setAbrindo] = useState(false);

  if (momento === "em-dia" && !mostrarEmDia) return null;

  // Vencido pede presença; vencendo pede discrição. A diferença é de cor e
  // peso, não de tamanho de texto nem de ícone de alerta.
  const urgente = momento === "carencia" || momento === "encerrado";
  const cor = urgente ? "#e9bd78" : "#e03a69";

  async function renovar() {
    if (abrindo) return;
    setAbrindo(true);
    track("PAYWALL_CTA", { payload: { origem: "aviso-renovacao", momento } });

    try {
      const resposta = await fetch("/api/pagamentos/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo: "assinatura",
          plano: "MONTHLY",
          metodo: "PIX",
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        show(dados.erro ?? "Não foi possível continuar.", "ruim");
        setAbrindo(false);
        return;
      }

      router.push(`/pagamento/${dados.attemptId}?tipo=assinatura`);
    } catch {
      show("Sem conexão com o servidor.", "ruim");
      setAbrindo(false);
    }
  }

  return (
    <section
      className="overflow-hidden rounded-3xl border p-4"
      style={{
        borderColor: `${cor}38`,
        background: `linear-gradient(155deg, ${cor}14, transparent 70%)`,
      }}
    >
      <p
        className={`${compacta ? "text-[0.9375rem]" : "text-[1.0625rem]"} font-semibold leading-tight text-cream-50`}
      >
        {titulo}
      </p>
      <p className="mt-1 text-[0.8125rem] leading-snug text-cream-400">
        {detalhe}
      </p>

      <Botao
        largura="cheia"
        tamanho={compacta ? "medio" : "grande"}
        variante={urgente ? "ouro" : "principal"}
        className="mt-3.5"
        disabled={abrindo}
        onClick={renovar}
      >
        {abrindo ? "Preparando o Pix…" : acao}
      </Botao>
    </section>
  );
}
