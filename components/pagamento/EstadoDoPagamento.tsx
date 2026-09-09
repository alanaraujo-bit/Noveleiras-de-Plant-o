"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { IconeCheck } from "@/components/ui/icones";
import { Botao, BotaoLink } from "@/components/ui/primitivos";

/**
 * Acompanhamento de uma cobrança.
 *
 * A tela **nunca decide** que o pagamento foi aprovado. Ela pergunta ao
 * servidor, que reconsulta o provedor. Voltar de um checkout com
 * `?status=approved` na URL não libera nada — é a diferença entre um paywall
 * e uma decoração, e é o erro mais comum em integração de pagamento.
 *
 * O intervalo de consulta cresce a cada tentativa. Pix costuma levar de
 * segundos a minutos, e bater no servidor a cada segundo por cinco minutos
 * seria carga sem retorno.
 */

type Estado =
  | "CREATED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "ERROR";

type Cobranca = {
  id: string;
  status: Estado;
  tipo: "SUBSCRIPTION" | "PURCHASE";
  valorCents: number;
  metodo: string | null;
  checkoutUrl: string | null;
  pixQrCode: string | null;
  expiraEm: string | null;
  mensagem: string | null;
  /**
   * Como o provedor descreveu o estado, cru.
   *
   * Serve para separar "voce cancelou" de "o prazo acabou": os dois caem em
   * EXPIRED no nosso enum, mas dizer "cobranca expirada" a quem clicou em
   * cancelar e confuso o bastante para gerar suporte.
   */
  motivoCru: string | null;
};

const ESPERAS_MS = [1500, 2000, 3000, 4000, 6000, 8000, 10_000, 15_000];

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function EstadoDoPagamento({
  inicial,
  destino,
  nomeDoItem,
}: {
  inicial: Cobranca;
  /** Para onde ir depois de aprovado — normalmente a novela que a pessoa queria. */
  destino: string;
  nomeDoItem: string;
}) {
  const router = useRouter();
  const { track } = useTelemetry();
  const [cobranca, setCobranca] = useState<Cobranca>(inicial);
  const [copiado, setCopiado] = useState(false);
  const tentativas = useRef(0);
  const avisado = useRef(false);

  const finalizado =
    cobranca.status === "APPROVED" ||
    cobranca.status === "REJECTED" ||
    cobranca.status === "EXPIRED";

  const consultar = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/pagamentos/estado/${inicial.id}`, {
        cache: "no-store",
      });
      if (!resposta.ok) return;
      const dados = (await resposta.json()) as Cobranca;
      setCobranca((antes) => ({ ...antes, ...dados }));
    } catch {
      // Rede instável não muda o estado da cobrança. A próxima tentativa vai.
    }
  }, [inicial.id]);

  useEffect(() => {
    if (finalizado) return;

    const espera =
      ESPERAS_MS[Math.min(tentativas.current, ESPERAS_MS.length - 1)];
    const timer = setTimeout(() => {
      tentativas.current += 1;
      void consultar();
    }, espera);

    return () => clearTimeout(timer);
  }, [cobranca, consultar, finalizado]);

  useEffect(() => {
    if (avisado.current) return;

    if (cobranca.status === "APPROVED") {
      avisado.current = true;
      track(
        cobranca.tipo === "PURCHASE" ? "PURCHASE_COMPLETE" : "CHECKOUT_APPROVED",
        { payload: { valorCents: cobranca.valorCents } },
      );
      // `refresh` antes de navegar: a sessão precisa recarregar os direitos,
      // senão a página de destino ainda mostraria o cadeado.
      router.refresh();
    }

    if (cobranca.status === "REJECTED") {
      avisado.current = true;
      track("CHECKOUT_REJECTED", { payload: { motivo: cobranca.mensagem } });
    }
  }, [cobranca, router, track]);

  async function copiarPix() {
    if (!cobranca.pixQrCode) return;
    try {
      await navigator.clipboard.writeText(cobranca.pixQrCode);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }

  if (cobranca.status === "APPROVED") {
    return (
      <Moldura>
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="grid size-16 place-items-center rounded-full bg-jade-400/15 text-jade-400"
        >
          <IconeCheck tamanho={30} />
        </motion.div>

        <h1 className="mt-5 text-[1.5rem] leading-tight">Pagamento aprovado</h1>
        <p className="mt-2 text-[0.875rem] text-cream-400">
          {cobranca.tipo === "PURCHASE"
            ? `${nomeDoItem} é sua para sempre. Todos os episódios liberados, inclusive os que entrarem depois.`
            : `${nomeDoItem} ativo. O catálogo inteiro está liberado.`}
        </p>

        <BotaoLink href={destino} tamanho="grande" largura="cheia" className="mt-7">
          Continuar assistindo
        </BotaoLink>
      </Moldura>
    );
  }

  if (cobranca.status === "REJECTED") {
    return (
      <Moldura>
        <div className="grid size-16 place-items-center rounded-full bg-rose-700/25 text-2xl">
          ✕
        </div>
        <h1 className="mt-5 text-[1.5rem] leading-tight">Pagamento recusado</h1>
        <p className="mt-2 text-[0.875rem] text-cream-400">
          O pagamento não foi autorizado e nada foi cobrado. Isso costuma ser
          limite, dados do cartão ou uma trava do banco.
        </p>
        {cobranca.mensagem ? (
          <p className="mt-2 text-[0.75rem] text-cream-600">
            {cobranca.mensagem}
          </p>
        ) : null}

        <Botao
          tamanho="grande"
          largura="cheia"
          className="mt-7"
          onClick={() => router.push("/planos")}
        >
          Tentar de outro jeito
        </Botao>
        <BotaoLink
          href={destino}
          variante="fantasma"
          tamanho="medio"
          largura="cheia"
          className="mt-2"
        >
          Voltar
        </BotaoLink>
      </Moldura>
    );
  }

  if (cobranca.status === "EXPIRED") {
    // O nosso enum não distingue os dois, mas o provedor sim. Quem clicou em
    // "cancelar" não pode ler "expirou": parece erro do sistema.
    const cancelou = /cancel/i.test(cobranca.motivoCru ?? "");

    return (
      <Moldura>
        <div className="grid size-16 place-items-center rounded-full bg-white/8 text-2xl">
          {cancelou ? "↩" : "⏳"}
        </div>
        <h1 className="mt-5 text-[1.5rem] leading-tight">
          {cancelou ? "Pagamento cancelado" : "Cobrança expirada"}
        </h1>
        <p className="mt-2 text-[0.875rem] text-cream-400">
          {cancelou
            ? "Você saiu do pagamento antes de concluir e nada foi cobrado. Pode retomar quando quiser."
            : "O prazo desta cobrança acabou e nada foi debitado. É só começar de novo."}
        </p>
        <Botao
          tamanho="grande"
          largura="cheia"
          className="mt-7"
          onClick={() => router.push("/planos")}
        >
          {cancelou ? "Escolher um plano" : "Começar de novo"}
        </Botao>
        <BotaoLink
          href={destino}
          variante="fantasma"
          tamanho="medio"
          largura="cheia"
          className="mt-2"
        >
          Voltar
        </BotaoLink>
      </Moldura>
    );
  }

  // Pendente.
  return (
    <Moldura>
      <motion.div
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="grid size-16 place-items-center rounded-full bg-white/8 text-2xl"
      >
        ◷
      </motion.div>

      <h1 className="mt-5 text-[1.5rem] leading-tight">
        {cobranca.pixQrCode ? "Esperando o Pix" : "Confirmando o pagamento"}
      </h1>
      <p className="mt-2 text-[0.875rem] text-cream-400">
        {cobranca.pixQrCode
          ? `Pague ${reais(cobranca.valorCents)} pelo código abaixo. A tela vira sozinha assim que o banco confirmar.`
          : "Assim que o provedor confirmar, o acesso é liberado automaticamente. Pode deixar esta tela aberta."}
      </p>

      {cobranca.pixQrCode ? (
        <div className="mt-6 w-full">
          <p className="mb-2 text-left text-[0.6875rem] uppercase tracking-wider text-cream-600">
            Pix copia e cola
          </p>
          <p className="break-all rounded-xl border border-white/10 bg-black/25 p-3 text-left font-mono text-[0.6875rem] leading-relaxed text-cream-400">
            {cobranca.pixQrCode}
          </p>
          <Botao largura="cheia" className="mt-3" onClick={copiarPix}>
            {copiado ? "Código copiado" : "Copiar código"}
          </Botao>
        </div>
      ) : null}

      {cobranca.checkoutUrl ? (
        <BotaoLink
          href={cobranca.checkoutUrl}
          tamanho="grande"
          largura="cheia"
          className="mt-4"
        >
          Abrir o pagamento
        </BotaoLink>
      ) : null}

      <button
        type="button"
        onClick={() => void consultar()}
        className="tap mt-5 text-[0.8125rem] text-rose-300 underline underline-offset-4"
      >
        Já paguei, conferir agora
      </button>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ paddingTop: "var(--safe-t)", paddingBottom: "var(--safe-b)" }}
    >
      <div className="w-full max-w-sm flex flex-col items-center">{children}</div>
    </div>
  );
}
