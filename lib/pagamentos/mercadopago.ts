/**
 * Mercado Pago.
 *
 * Escrito inteiro sobre `fetch` em vez do SDK oficial. Três razões: o SDK
 * traz um cliente HTTP próprio e dependências que não precisamos; a
 * superfície que usamos são seis endpoints; e a validação de webhook precisa
 * do corpo **cru**, que o SDK não expõe de forma confiável.
 *
 * Nada aqui lê credencial no momento do import — só quando uma chamada
 * acontece. É isso que permite o aplicativo inteiro subir, compilar e ser
 * testado sem nenhuma credencial existir.
 *
 * Documentação das variáveis: `docs/mercado-pago.md`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  FalhaDoProvedor,
  ProvedorNaoConfigurado,
  type ConsultaAssinatura,
  type ConsultaPagamento,
  type CriarAssinaturaEntrada,
  type CriarCompraEntrada,
  type EstadoProvedor,
  type ProvedorDePagamento,
  type RespostaCheckout,
  type ResultadoReembolso,
  type WebhookLido,
} from "./provedor";

const API = "https://api.mercadopago.com";

type Credenciais = {
  accessToken: string;
  webhookSecret: string;
  notificationUrl: string | null;
};

function lerCredenciais(): Credenciais {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? "";

  const faltando: string[] = [];
  if (!accessToken) faltando.push("MERCADOPAGO_ACCESS_TOKEN");
  if (!webhookSecret) faltando.push("MERCADOPAGO_WEBHOOK_SECRET");
  if (faltando.length) throw new ProvedorNaoConfigurado(faltando);

  return {
    accessToken,
    webhookSecret,
    notificationUrl:
      process.env.MERCADOPAGO_NOTIFICATION_URL?.trim() || null,
  };
}

export function credenciaisPresentes(): boolean {
  return Boolean(
    process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() &&
      process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim(),
  );
}

/**
 * Vocabulário do Mercado Pago traduzido para o nosso.
 *
 * `in_process` e `in_mediation` viram PENDING de propósito: são estados em
 * que o dinheiro ainda não é nosso, e tratá-los como aprovado liberaria
 * conteúdo antes da confirmação.
 */
function traduzirStatusPagamento(status: string | null): EstadoProvedor {
  switch (status) {
    case "approved":
    case "authorized":
      return "APPROVED";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "PENDING";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELED";
    case "refunded":
      return "REFUNDED";
    case "charged_back":
      return "CHARGEBACK";
    default:
      return "UNKNOWN";
  }
}

function traduzirStatusAssinatura(status: string | null): EstadoProvedor {
  switch (status) {
    case "authorized":
      return "APPROVED";
    case "pending":
      return "PENDING";
    case "paused":
      return "PENDING";
    case "cancelled":
      return "CANCELED";
    default:
      return "UNKNOWN";
  }
}

async function chamar<T>(
  caminho: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const { accessToken } = lerCredenciais();
  const { idempotencyKey, ...resto } = init;

  const resposta = await fetch(`${API}${caminho}`, {
    ...resto,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // Dois cliques no botão não podem virar duas cobranças no lado deles.
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      ...(resto.headers ?? {}),
    },
    // O checkout não pode ficar pendurado numa aba aberta indefinidamente.
    signal: AbortSignal.timeout(15_000),
  });

  const texto = await resposta.text();
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }

  if (!resposta.ok) {
    throw new FalhaDoProvedor(
      `Mercado Pago respondeu ${resposta.status} em ${caminho}`,
      resposta.status,
      corpo,
    );
  }

  return corpo as T;
}

function reais(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export class MercadoPago implements ProvedorDePagamento {
  readonly nome = "mercadopago";

  get configurado(): boolean {
    return credenciaisPresentes();
  }

  /**
   * Assinatura recorrente (`preapproval`).
   *
   * O Mercado Pago cobra recorrência só no cartão; Pix não tem débito
   * automático. Por isso a tela de planos oferece Pix apenas na compra
   * avulsa — e aqui a tentativa de assinar por Pix é recusada em vez de
   * criar algo que nunca renovaria.
   */
  async criarAssinatura(
    entrada: CriarAssinaturaEntrada,
  ): Promise<RespostaCheckout> {
    if (entrada.metodo === "PIX") {
      throw new FalhaDoProvedor(
        "Assinatura recorrente exige cartão: o Pix não suporta débito automático.",
      );
    }

    const { notificationUrl } = lerCredenciais();

    const corpo = {
      reason: entrada.plano.nome,
      external_reference: entrada.referenciaExterna,
      payer_email: entrada.usuario.email,
      back_url: entrada.urlRetorno,
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      auto_recurring: {
        // `preapproval` só aceita `months` ou `days` como unidade: o plano
        // anual é declarado como 12 meses, não como "1 ano".
        frequency:
          entrada.plano.intervalo === "YEAR"
            ? 12 * entrada.plano.intervaloCount
            : entrada.plano.intervaloCount,
        frequency_type: "months",
        transaction_amount: reais(entrada.plano.precoCents),
        currency_id: entrada.plano.moeda,
      },
    };

    const resposta = await chamar<{
      id: string;
      status: string;
      init_point?: string;
      sandbox_init_point?: string;
    }>("/preapproval", {
      method: "POST",
      body: JSON.stringify(corpo),
      idempotencyKey: entrada.idempotencyKey,
    });

    return {
      externalId: resposta.id ?? null,
      status: traduzirStatusAssinatura(resposta.status ?? null),
      checkoutUrl: resposta.init_point ?? resposta.sandbox_init_point ?? null,
      pixQrCode: null,
      pixQrCodeBase64: null,
      expiraEm: null,
      bruto: resposta,
    };
  }

  async criarCompra(entrada: CriarCompraEntrada): Promise<RespostaCheckout> {
    return entrada.metodo === "PIX"
      ? this.compraPorPix(entrada)
      : this.compraPorCheckout(entrada);
  }

  /** Pix: cobrança direta, devolve o copia-e-cola. */
  private async compraPorPix(
    entrada: CriarCompraEntrada,
  ): Promise<RespostaCheckout> {
    const { notificationUrl } = lerCredenciais();

    const resposta = await chamar<{
      id: number;
      status: string;
      date_of_expiration?: string;
      point_of_interaction?: {
        transaction_data?: { qr_code?: string; qr_code_base64?: string };
      };
    }>("/v1/payments", {
      method: "POST",
      idempotencyKey: entrada.idempotencyKey,
      body: JSON.stringify({
        transaction_amount: reais(entrada.valorCents),
        description: `Novela: ${entrada.novela.titulo}`,
        payment_method_id: "pix",
        external_reference: entrada.referenciaExterna,
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        payer: {
          email: entrada.usuario.email,
          first_name: entrada.usuario.nome,
        },
      }),
    });

    const dados = resposta.point_of_interaction?.transaction_data;

    return {
      externalId: resposta.id ? String(resposta.id) : null,
      status: traduzirStatusPagamento(resposta.status ?? null),
      checkoutUrl: null,
      pixQrCode: dados?.qr_code ?? null,
      pixQrCodeBase64: dados?.qr_code_base64 ?? null,
      expiraEm: resposta.date_of_expiration
        ? new Date(resposta.date_of_expiration)
        : null,
      bruto: resposta,
    };
  }

  /** Cartão: preferência do Checkout Pro, hospedado por eles. */
  private async compraPorCheckout(
    entrada: CriarCompraEntrada,
  ): Promise<RespostaCheckout> {
    const { notificationUrl } = lerCredenciais();

    const resposta = await chamar<{
      id: string;
      init_point?: string;
      sandbox_init_point?: string;
    }>("/checkout/preferences", {
      method: "POST",
      idempotencyKey: entrada.idempotencyKey,
      body: JSON.stringify({
        external_reference: entrada.referenciaExterna,
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        items: [
          {
            id: entrada.novela.id,
            title: entrada.novela.titulo,
            quantity: 1,
            currency_id: "BRL",
            unit_price: reais(entrada.valorCents),
          },
        ],
        payer: {
          email: entrada.usuario.email,
          name: entrada.usuario.nome,
        },
        back_urls: {
          success: entrada.urlRetorno,
          pending: entrada.urlRetorno,
          failure: entrada.urlRetorno,
        },
        auto_return: "approved",
      }),
    });

    return {
      externalId: resposta.id ?? null,
      status: "PENDING",
      checkoutUrl: resposta.init_point ?? resposta.sandbox_init_point ?? null,
      pixQrCode: null,
      pixQrCodeBase64: null,
      expiraEm: null,
      bruto: resposta,
    };
  }

  async consultarPagamento(
    externalId: string,
  ): Promise<ConsultaPagamento | null> {
    try {
      const p = await chamar<{
        id: number;
        status: string;
        status_detail?: string;
        transaction_amount: number;
        currency_id?: string;
        payment_method_id?: string;
        external_reference?: string;
        date_approved?: string;
        transaction_amount_refunded?: number;
      }>(`/v1/payments/${encodeURIComponent(externalId)}`);

      return {
        externalId: String(p.id),
        status: traduzirStatusPagamento(p.status ?? null),
        valorCents: Math.round((p.transaction_amount ?? 0) * 100),
        moeda: p.currency_id ?? "BRL",
        metodo: p.payment_method_id ?? null,
        referenciaExterna: p.external_reference ?? null,
        aprovadoEm: p.date_approved ? new Date(p.date_approved) : null,
        reembolsadoCents: Math.round(
          (p.transaction_amount_refunded ?? 0) * 100,
        ),
        statusCru: p.status ?? null,
        detalheCru: p.status_detail ?? null,
        bruto: p,
      };
    } catch (erro) {
      if (erro instanceof FalhaDoProvedor && erro.status === 404) return null;
      throw erro;
    }
  }

  async consultarAssinatura(
    externalId: string,
  ): Promise<ConsultaAssinatura | null> {
    try {
      const a = await chamar<{
        id: string;
        status: string;
        external_reference?: string;
        next_payment_date?: string;
      }>(`/preapproval/${encodeURIComponent(externalId)}`);

      return {
        externalId: a.id,
        status: traduzirStatusAssinatura(a.status ?? null),
        referenciaExterna: a.external_reference ?? null,
        proximaCobranca: a.next_payment_date
          ? new Date(a.next_payment_date)
          : null,
        bruto: a,
      };
    } catch (erro) {
      if (erro instanceof FalhaDoProvedor && erro.status === 404) return null;
      throw erro;
    }
  }

  async cancelarAssinatura(externalId: string): Promise<void> {
    await chamar(`/preapproval/${encodeURIComponent(externalId)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
  }

  async reembolsar(
    externalId: string,
    valorCents?: number,
  ): Promise<ResultadoReembolso> {
    const r = await chamar<{ id: number; status: string; amount: number }>(
      `/v1/payments/${encodeURIComponent(externalId)}/refunds`,
      {
        method: "POST",
        // Sem corpo, o Mercado Pago reembolsa o valor cheio.
        body: JSON.stringify(
          valorCents ? { amount: reais(valorCents) } : {},
        ),
        idempotencyKey: `refund-${externalId}-${valorCents ?? "total"}`,
      },
    );

    return {
      externalId: r.id ? String(r.id) : null,
      status: r.status === "approved" ? "REFUNDED" : "PENDING",
      valorCents: Math.round((r.amount ?? 0) * 100),
      bruto: r,
    };
  }

  /**
   * Confere a assinatura HMAC do webhook.
   *
   * O manifesto é montado exatamente como eles especificam —
   * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — e o `data.id` sai da
   * **query string**, não do corpo: o corpo pode ser reserializado por
   * qualquer proxy no caminho e a conferência quebraria.
   *
   * A comparação é em tempo constante. Comparar hash com `===` vaza, por
   * diferença de tempo, quantos bytes iniciais o atacante acertou.
   */
  async lerWebhook(
    corpoCru: string,
    cabecalhos: Headers,
    url: URL,
  ): Promise<WebhookLido> {
    const { webhookSecret } = lerCredenciais();

    let payload: Record<string, unknown> = {};
    try {
      payload = corpoCru ? (JSON.parse(corpoCru) as Record<string, unknown>) : {};
    } catch {
      payload = { corpoInvalido: corpoCru.slice(0, 500) };
    }

    const assinatura = cabecalhos.get("x-signature") ?? "";
    const requestId = cabecalhos.get("x-request-id") ?? "";

    const partes = new Map(
      assinatura.split(",").map((p) => {
        const [k, ...v] = p.split("=");
        return [k.trim(), v.join("=").trim()] as const;
      }),
    );
    const ts = partes.get("ts") ?? "";
    const v1 = partes.get("v1") ?? "";

    const dataId =
      url.searchParams.get("data.id") ??
      url.searchParams.get("id") ??
      (typeof (payload.data as { id?: unknown } | undefined)?.id === "string" ||
      typeof (payload.data as { id?: unknown } | undefined)?.id === "number"
        ? String((payload.data as { id: unknown }).id)
        : null);

    // Eles normalizam ids alfanuméricos para minúsculas antes de assinar.
    const idNormalizado = dataId ? dataId.toLowerCase() : "";
    const manifesto = `id:${idNormalizado};request-id:${requestId};ts:${ts};`;

    const esperado = createHmac("sha256", webhookSecret)
      .update(manifesto)
      .digest("hex");

    const assinaturaValida = comparaSegura(esperado, v1);

    const topico =
      (typeof payload.type === "string" && payload.type) ||
      (typeof payload.topic === "string" && payload.topic) ||
      url.searchParams.get("type") ||
      url.searchParams.get("topic") ||
      "desconhecido";

    const acao = typeof payload.action === "string" ? payload.action : null;

    return {
      assinaturaValida,
      // O `id` do envelope é o do evento; quando falta, o par recurso+ação é
      // estável o bastante para barrar reentrega da mesma notificação.
      eventId:
        (payload.id !== undefined && payload.id !== null
          ? String(payload.id)
          : null) ?? `${topico}:${acao ?? "sem-acao"}:${dataId ?? "sem-id"}`,
      topico,
      acao,
      recursoId: dataId,
      payload,
    };
  }
}

function comparaSegura(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}
