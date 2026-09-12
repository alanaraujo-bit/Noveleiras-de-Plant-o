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
  /** `MANUAL_RENEW` é o mensal por Pix: um mês por vez, renovado à mão. */
  renovacao?: "AUTO_RENEW" | "MANUAL_RENEW" | null;
  valorCents: number;
  metodo: string | null;
  checkoutUrl: string | null;
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
  expiraEm: string | null;
  /**
   * Até quando o acesso vai valer, decidido pelo servidor.
   *
   * Nunca calculado aqui: quem renovou antes do vencimento recebeu dias
   * encadeados, e quem pagou dentro da carência não recebeu nenhum. O cliente
   * não tem como saber em qual dos dois casos está.
   */
  liberadoAte?: string | null;
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

/** "11 de outubro" — como esta fase fala de data para quem paga. */
function porExtenso(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
  });
}

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
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
  const [gerando, setGerando] = useState(false);
  const tentativas = useRef(0);
  const avisado = useRef(false);

  // Mensal por Pix: um Pix expirado não é um beco, é só um código velho. O
  // botão de gerar outro só existe aqui porque só aqui há o que gerar — numa
  // compra avulsa o caminho volta pela página da novela.
  const mensalPorPix =
    cobranca.tipo === "SUBSCRIPTION" && cobranca.renovacao === "MANUAL_RENEW";

  async function gerarNovoPix() {
    if (gerando) return;
    setGerando(true);
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
        setGerando(false);
        return;
      }
      // Tentativa nova, endereço novo: a anterior fica no histórico, que é
      // como se descobre depois quantos QR nunca viraram pagamento.
      router.push(`/pagamento/${dados.attemptId}?tipo=assinatura`);
    } catch {
      setGerando(false);
    }
  }

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
            : cobranca.liberadoAte
              ? // A data é a informação, não um detalhe: é ela que responde
                // "e agora, quanto tempo eu tenho?" antes de a pessoa
                // precisar perguntar.
                `Seu Plantão está liberado até ${porExtenso(cobranca.liberadoAte)}. O catálogo inteiro é seu.`
              : `${nomeDoItem} ativo. O catálogo inteiro está liberado.`}
        </p>

        {mensalPorPix ? (
          <p className="mt-2 text-[0.75rem] leading-relaxed text-cream-600">
            Nada será cobrado de novo sozinho. Perto do vencimento a gente
            avisa, e renovar é um toque.
          </p>
        ) : null}

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
          {/* A frase já vem traduzida do servidor; o código do provedor
              (`cc_rejected_…`) fica no log, nunca aqui. */}
          {cobranca.mensagem ??
            "Não foi possível aprovar este pagamento. Tente outro cartão ou meio de pagamento."}
        </p>
        <p className="mt-2 text-[0.75rem] text-cream-600">
          Nada foi cobrado.
        </p>

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

    // Um Pix que venceu não é um problema, é um código velho. Nem ícone de
    // alerta, nem explicação: uma frase e o botão que resolve.
    if (mensalPorPix && !cancelou) {
      return (
        <Moldura>
          <div className="grid size-16 place-items-center rounded-full bg-white/8 text-2xl">
            ⏳
          </div>
          <h1 className="mt-5 text-[1.5rem] leading-tight">Esse Pix expirou</h1>
          <p className="mt-2 text-[0.875rem] text-cream-400">
            Nada foi cobrado. É só gerar outro — leva um instante.
          </p>
          <Botao
            tamanho="grande"
            largura="cheia"
            className="mt-7"
            disabled={gerando}
            onClick={() => void gerarNovoPix()}
          >
            {gerando ? "Gerando…" : "Gerar novo Pix"}
          </Botao>
          <BotaoLink
            href={destino}
            variante="fantasma"
            tamanho="medio"
            largura="cheia"
            className="mt-2"
          >
            Agora não
          </BotaoLink>
        </Moldura>
      );
    }

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
          ? `Pague ${reais(cobranca.valorCents)} no aplicativo do seu banco. Esta tela vira sozinha quando o pagamento cair.`
          : "Assim que o provedor confirmar, o acesso é liberado automaticamente. Pode deixar esta tela aberta."}
      </p>

      {cobranca.pixQrCode ? (
        <div className="mt-6 w-full">
          {/* O QR primeiro: quem paga em outro aparelho aponta a câmera e
              pronto. Quem paga no mesmo celular usa o botão de copiar logo
              abaixo — os dois caminhos à vista, nenhum escondido numa aba. */}
          {cobranca.pixQrCodeBase64 ? (
            <div className="mx-auto w-fit rounded-3xl bg-white p-3">
              {/* `img` cru, e não `next/image`: é um data URI que já está na
                  memória. Passá-lo pelo otimizador seria trabalho para não
                  mudar um pixel. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${cobranca.pixQrCodeBase64}`}
                alt="QR Code para pagar com Pix"
                width={188}
                height={188}
                className="block size-[188px]"
              />
            </div>
          ) : null}

          <Botao
            largura="cheia"
            tamanho="grande"
            variante={copiado ? "secundario" : "principal"}
            className="mt-4"
            onClick={copiarPix}
          >
            {copiado ? "Código copiado ✓" : "Copiar código Pix"}
          </Botao>

          <details className="mt-3 text-left">
            <summary className="tap cursor-pointer list-none text-center text-[0.75rem] text-cream-600 underline underline-offset-4">
              Ver o código
            </summary>
            <p className="mt-2 break-all rounded-xl border border-white/10 bg-black/25 p-3 font-mono text-[0.6875rem] leading-relaxed text-cream-400">
              {cobranca.pixQrCode}
            </p>
          </details>

          {cobranca.expiraEm ? (
            <p className="mt-3 text-center text-[0.75rem] text-cream-600">
              Esse código vale até {horaCurta(cobranca.expiraEm)}. Depois disso
              é só gerar outro.
            </p>
          ) : null}
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
