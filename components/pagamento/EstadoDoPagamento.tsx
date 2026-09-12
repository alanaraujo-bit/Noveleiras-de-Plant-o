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
  /**
   * Qual mês esta cobrança pagou. 1 é a primeira assinatura; 2 ou mais é
   * renovação, e a tela fala diferente nos dois casos.
   */
  ciclo?: number | null;
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
  const [mostrarQr, setMostrarQr] = useState(false);
  const tentativas = useRef(0);
  const avisado = useRef(false);

  // Mensal por Pix: um Pix expirado não é um beco, é só um código velho. O
  // botão de gerar outro só existe aqui porque só aqui há o que gerar — numa
  // compra avulsa o caminho volta pela página da novela.
  const mensalPorPix =
    cobranca.tipo === "SUBSCRIPTION" && cobranca.renovacao === "MANUAL_RENEW";

  // Segundo mês ou além. O número do ciclo vem do servidor porque só ele sabe:
  // o cliente não tem como distinguir uma primeira assinatura de uma renovação
  // antecipada que encadeou dias.
  const renovacaoConcluida =
    cobranca.tipo === "SUBSCRIPTION" && (cobranca.ciclo ?? 1) > 1;

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

        {/* Renovação e primeira assinatura merecem frases diferentes: quem
            renovou antes do vencimento precisa ver que **ganhou** tempo, não
            que recomeçou. O "agora" e a data nova fazem esse trabalho. */}
        <h1 className="mt-5 text-[1.5rem] leading-tight">
          {renovacaoConcluida ? "Renovação concluída" : "Pagamento aprovado"}
        </h1>
        <p className="mt-2 text-[0.875rem] leading-snug text-cream-400">
          {cobranca.tipo === "PURCHASE"
            ? `${nomeDoItem} é sua para sempre. Todos os episódios liberados, inclusive os que entrarem depois.`
            : cobranca.liberadoAte
              ? // A data é a informação, não um detalhe: é ela que responde
                // "e agora, quanto tempo eu tenho?" antes de a pessoa
                // precisar perguntar.
                renovacaoConcluida
                ? `Seu Plantão agora está liberado até ${porExtenso(cobranca.liberadoAte)}.`
                : `Seu Plantão está liberado até ${porExtenso(cobranca.liberadoAte)}.`
              : `${nomeDoItem} ativo. O catálogo inteiro está liberado.`}
        </p>

        {renovacaoConcluida ? (
          <p className="mt-2 text-[0.75rem] leading-relaxed text-cream-600">
            Os dias que ainda faltavam entraram no novo mês — nada se perdeu.
          </p>
        ) : mensalPorPix ? (
          <p className="mt-2 text-[0.75rem] leading-relaxed text-cream-600">
            Nada será cobrado de novo sozinho. Perto do vencimento a gente
            avisa, e renovar é um toque.
          </p>
        ) : null}

        <BotaoLink href={destino} tamanho="grande" largura="cheia" className="mt-7">
          Começar a assistir
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
            Gere um novo código para continuar. Nada foi cobrado.
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

  // ------------------------------------------------------- Pix pendente
  //
  // A tela mais importante desta fase, e a ordem dos elementos é o desenho:
  //
  // 1. **Copiar é a ação principal.** No celular — que é onde o produto vive —
  //    ninguém escaneia com a câmera o QR que está na própria tela. Deixar o
  //    QR grande no topo era mandar a pessoa resolver um problema que ela não
  //    tem como resolver naquele aparelho.
  // 2. **Os três passos**, curtos, porque "Copia e Cola" não é óbvio para
  //    quem não usa Pix toda semana.
  // 3. **A confirmação é automática, e isso é dito.** Sem essa frase, o botão
  //    de conferir parece obrigatório — e quem fecha o aplicativo acha que
  //    perdeu o pagamento.
  // 4. **O QR continua ali**, recolhido no celular (serve para pagar em outro
  //    aparelho) e aberto no desktop, onde é o caminho natural.
  if (cobranca.pixQrCode) {
    return (
      <Moldura larga>
        <p className="eyebrow">{nomeDoItem}</p>
        <h1 className="mt-0.5 text-[1.5rem] leading-tight">Pix gerado</h1>
        <p className="mt-3 text-[2rem] font-bold leading-none tracking-tight text-cream-50">
          {reais(cobranca.valorCents)}
        </p>
        <p className="mt-2.5 text-[0.875rem] leading-snug text-cream-400">
          Assim que você pagar, seu Plantão será liberado automaticamente.
        </p>

        {/* Ação principal. */}
        <Botao
          largura="cheia"
          tamanho="grande"
          variante={copiado ? "secundario" : "principal"}
          className="mt-6"
          onClick={copiarPix}
        >
          {copiado ? "Código Pix copiado ✓" : "Copiar código Pix"}
        </Botao>

        {/* `aria-live`: quem usa leitor de tela precisa ouvir que copiou, e
            o texto muda no mesmo lugar em vez de abrir um aviso por cima. */}
        <p
          aria-live="polite"
          className="mt-2 min-h-[1.25rem] text-[0.8125rem] font-medium text-jade-400"
        >
          {copiado ? "Agora é só colar no app do seu banco." : ""}
        </p>

        <ol className="mt-3 w-full space-y-1.5 text-left">
          {[
            "Abra o app do seu banco",
            "Escolha Pix › Copia e Cola",
            "Cole o código e confirme",
          ].map((passo, indice) => (
            <li
              key={passo}
              className="flex items-center gap-2.5 text-[0.8125rem] text-cream-300"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/8 text-[0.6875rem] font-semibold text-cream-400">
                {indice + 1}
              </span>
              {passo}
            </li>
          ))}
        </ol>

        {/* Estado do pagamento, dito sem alarme. */}
        <div className="mt-5 flex w-full items-start gap-2.5 rounded-2xl border border-white/8 bg-white/[0.02] p-3.5 text-left">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="mt-1.5 block size-2 shrink-0 rounded-full bg-jade-400"
          />
          <span>
            <span className="block text-[0.8125rem] font-semibold text-cream-100">
              Aguardando pagamento
            </span>
            <span className="mt-0.5 block text-[0.75rem] leading-snug text-cream-500">
              A confirmação é automática. Você pode fechar o aplicativo — o
              acesso é liberado do mesmo jeito.
            </span>
          </span>
        </div>

        {/* QR: escondido no celular até ser pedido, aberto no desktop. Sem
            detectar largura em JavaScript — o servidor não sabe o tamanho da
            tela, e adivinhar daria uma pintura errada no primeiro quadro. */}
        {cobranca.pixQrCodeBase64 ? (
          <>
            <button
              type="button"
              aria-expanded={mostrarQr}
              onClick={() => setMostrarQr((v) => !v)}
              className="tap mt-4 text-[0.8125rem] text-cream-400 underline underline-offset-4 md:hidden"
            >
              {mostrarQr ? "Esconder QR Code" : "Pagar em outro aparelho"}
            </button>

            <div
              className={`${mostrarQr ? "block" : "hidden"} w-full md:block`}
            >
              <div className="mx-auto mt-4 w-fit rounded-3xl bg-white p-3">
                {/* `img` cru, e não `next/image`: é um data URI que já está na
                    memória. Passá-lo pelo otimizador seria trabalho para não
                    mudar um pixel. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${cobranca.pixQrCodeBase64}`}
                  alt="QR Code para pagar com Pix"
                  width={200}
                  height={200}
                  className="block size-[200px]"
                />
              </div>
              <p className="mt-2 text-[0.75rem] text-cream-600">
                Aponte a câmera de outro aparelho para este código.
              </p>
            </div>
          </>
        ) : null}

        <details className="mt-4 w-full text-left">
          <summary className="tap cursor-pointer list-none text-center text-[0.75rem] text-cream-600 underline underline-offset-4">
            Ver o código escrito
          </summary>
          <p className="mt-2 break-all rounded-xl border border-white/10 bg-black/25 p-3 font-mono text-[0.6875rem] leading-relaxed text-cream-400">
            {cobranca.pixQrCode}
          </p>
        </details>

        {cobranca.expiraEm ? (
          <p className="mt-4 text-[0.75rem] text-cream-600">
            Este código vale até {horaCurta(cobranca.expiraEm)}.
          </p>
        ) : null}

        {/* Reserva, e parece uma: a confirmação já acontece sozinha. */}
        <button
          type="button"
          onClick={() => void consultar()}
          className="tap mt-4 text-[0.75rem] text-cream-600 underline underline-offset-4"
        >
          Já paguei — conferir agora
        </button>
      </Moldura>
    );
  }

  // Pendente sem Pix: cartão, ou cobrança em análise.
  return (
    <Moldura>
      <motion.div
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="grid size-16 place-items-center rounded-full bg-white/8 text-2xl"
      >
        ◷
      </motion.div>

      <h1 className="mt-5 text-[1.5rem] leading-tight">Aguardando pagamento</h1>
      <p className="mt-2 text-[0.875rem] text-cream-400">
        A confirmação é automática: assim que o pagamento cair, o acesso é
        liberado. Você pode fechar o aplicativo.
      </p>

      {cobranca.checkoutUrl ? (
        <BotaoLink
          href={cobranca.checkoutUrl}
          tamanho="grande"
          largura="cheia"
          className="mt-6"
        >
          Abrir o pagamento
        </BotaoLink>
      ) : null}

      <button
        type="button"
        onClick={() => void consultar()}
        className="tap mt-5 text-[0.75rem] text-cream-600 underline underline-offset-4"
      >
        Já paguei — conferir agora
      </button>
    </Moldura>
  );
}

function Moldura({
  children,
  larga = false,
}: {
  children: React.ReactNode;
  /** A tela do Pix respira mais no desktop, onde o QR ganha protagonismo. */
  larga?: boolean;
}) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center"
      style={{ paddingTop: "var(--safe-t)", paddingBottom: "var(--safe-b)" }}
    >
      <div
        className={`flex w-full flex-col items-center ${larga ? "max-w-sm md:max-w-md" : "max-w-sm"}`}
      >
        {children}
      </div>
    </div>
  );
}
