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

import {
  FalhaDoProvedor,
  ProvedorNaoConfigurado,
  type ConsultaAssinatura,
  type ConsultaPagamento,
  type CriarAssinaturaEntrada,
  type CriarCobrancaPixEntrada,
  type CriarCompraEntrada,
  type EstadoProvedor,
  type FaturaDeAssinatura,
  type ProvedorDePagamento,
  type ResolucaoDePreferencia,
  type RespostaCheckout,
  type ResultadoReembolso,
  type WebhookLido,
} from "./provedor";
import { lerNotificacao } from "./notificacao";

const API ="https://api.mercadopago.com";

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
    notificationUrl: comoWebhook(
      process.env.MERCADOPAGO_NOTIFICATION_URL?.trim() || null,
    ),
  };
}

/**
 * Pede ao Mercado Pago o formato **Webhook** nesta URL, não o IPN legado.
 *
 * Sem `source_news=webhooks`, a `notification_url` de um pagamento ou
 * preferência recebe as duas notificações — e o IPN, que não tem a
 * assinatura do Webhook, chega ao receptor como se fosse forjado. Os
 * parâmetros que a URL já tiver continuam lá.
 */
export function comoWebhook(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("source_news", "webhooks");
    return u.toString();
  } catch {
    // URL malformada: o Mercado Pago a recusa do mesmo jeito que antes.
    return url;
  }
}

/**
 * Ordena os pagamentos de um pedido: o que decide primeiro.
 *
 * Um cartão recusado seguido de um aprovado deixa dois pagamentos no mesmo
 * pedido. Reconciliar pelo primeiro da lista marcaria a compra como recusada
 * mesmo tendo dinheiro entrado.
 */
const PESO_DO_STATUS: Record<string, number> = {
  approved: 0,
  authorized: 0,
  in_process: 1,
  pending: 1,
  in_mediation: 1,
  refunded: 2,
  charged_back: 2,
};

function ordenarPagamentos(
  pagamentos: Array<{ id?: number | string; status?: string }> | undefined,
): string[] {
  return (pagamentos ?? [])
    .filter((p) => p.id != null)
    .slice()
    .sort(
      (a, b) =>
        (PESO_DO_STATUS[a.status ?? ""] ?? 3) -
        (PESO_DO_STATUS[b.status ?? ""] ?? 3),
    )
    .map((p) => String(p.id));
}

/** O formato de `/authorized_payments`, como a API real devolve. */
type FaturaCrua = {
  id?: number | string;
  preapproval_id?: string;
  status?: string;
  external_reference?: string;
  debit_date?: string;
  date_created?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
  retry_attempt?: number;
  payment?: { id?: number | string; status?: string; status_detail?: string };
};

function traduzirFatura(f: FaturaCrua): FaturaDeAssinatura {
  const data = f.debit_date ?? f.date_created;
  return {
    id: String(f.id),
    preapprovalId: f.preapproval_id ?? null,
    statusCru: f.status ?? null,
    referenciaExterna: f.external_reference ?? null,
    dataDebito: data ? new Date(data) : null,
    valorCents: Math.round((f.transaction_amount ?? 0) * 100),
    moeda: f.currency_id ?? "BRL",
    metodo: f.payment_method_id ?? null,
    retentativa: f.retry_attempt ?? null,
    pagamento:
      f.payment?.id != null
        ? {
            id: String(f.payment.id),
            status: traduzirStatusPagamento(f.payment.status ?? null),
            statusCru: f.payment.status ?? null,
            detalheCru: f.payment.status_detail ?? null,
          }
        : null,
  };
}

// ------------------------------------------------------ pagador de teste
//
// O Mercado Pago recusa `/preapproval` com 400 e a mensagem "Both payer and
// collector must be real or test users" quando as credenciais pertencem a um
// usuario de teste e o pagador e uma pessoa real. Enquanto a operacao roda com
// credenciais de teste, o e-mail enviado ao provedor precisa ser o de um
// comprador de teste — e so ele: a tentativa, a compra e o direito continuam
// amarrados a conta real de quem clicou.

type ModoConhecido = { valor: boolean; em: number };

/**
 * Memoria curta do tipo de conta.
 *
 * Sem cache, todo checkout gastaria uma ida extra ao provedor so para
 * descobrir algo que muda no maximo quando alguem troca as credenciais.
 * O TTL curto garante que a migracao para producao seja notada sozinha, sem
 * ninguem precisar lembrar de reiniciar nada.
 */
let modoDeTesteConhecido: ModoConhecido | null = null;
const TTL_MODO_MS = 10 * 60_000;

/** Descarta a memoria do tipo de conta. Usado nos testes. */
export function esquecerModoDeTeste(): void {
  modoDeTesteConhecido = null;
}

/**
 * A conta dona do access token e um usuario de teste?
 *
 * Duas fontes, nesta ordem:
 *
 * 1. Prefixo `TEST-`, que identifica as credenciais de teste classicas.
 * 2. A tag `test_user` em `/users/me`. E o unico sinal confiavel para as
 *    credenciais de um **usuario de teste**, que vem com prefixo `APP_USR-`
 *    identico ao de producao — olhar so o prefixo daria producao como
 *    resposta e a substituicao nunca aconteceria.
 *
 * **Falha fechada.** Se a consulta nao responder, devolve `false`, ou seja,
 * "trate como producao". O erro seguro aqui e deixar de substituir o pagador
 * num ambiente de teste (o checkout falha visivelmente, como hoje); o erro
 * inseguro seria cobrar um comprador de teste achando que e producao.
 */
export async function contaEhDeTeste(): Promise<boolean> {
  const { accessToken } = lerCredenciais();
  if (accessToken.startsWith("TEST-")) return true;

  const agora = Date.now();
  if (modoDeTesteConhecido && agora - modoDeTesteConhecido.em < TTL_MODO_MS) {
    return modoDeTesteConhecido.valor;
  }

  try {
    const conta = await chamar<{ tags?: unknown }>("/users/me");
    const tags = Array.isArray(conta.tags) ? conta.tags : [];
    const teste = tags.includes("test_user");
    modoDeTesteConhecido = { valor: teste, em: agora };
    return teste;
  } catch {
    // Nao cacheia a duvida: a proxima tentativa consulta de novo.
    return false;
  }
}

export function emailDeTesteConfigurado(): string | null {
  return process.env.MERCADOPAGO_TEST_PAYER_EMAIL?.trim() || null;
}

export type PagadorResolvido = { email: string; substituido: boolean };

/**
 * Decide qual e-mail vai no corpo enviado ao provedor.
 *
 * A substituicao exige **as duas** condicoes: a variavel configurada e a conta
 * confirmada como de teste. Ao trocar para credenciais reais, a segunda deixa
 * de valer sozinha — o e-mail real da pessoa volta a ser usado sem que
 * ninguem precise remover a variavel.
 */
export async function resolverPagador(
  emailReal: string,
): Promise<PagadorResolvido> {
  const deTeste = emailDeTesteConfigurado();
  if (!deTeste) return { email: emailReal, substituido: false };

  if (!(await contaEhDeTeste())) {
    // Configuracao perigosa: alguem deixou a variavel para tras ao migrar.
    // Ignorar em silencio esconderia isso, entao fica registrado no log do
    // servidor — sem imprimir o endereco.
    console.warn(
      "[mercadopago] MERCADOPAGO_TEST_PAYER_EMAIL ignorado: as credenciais " +
        "nao pertencem a um usuario de teste. Remova a variavel.",
    );
    return { email: emailReal, substituido: false };
  }

  return { email: deTeste, substituido: true };
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
    // As duas grafias, de propósito: a documentação deles usa `canceled` na
    // página de cancelamento e no `/preapproval/export`, e `cancelled` nas de
    // ciclo de vida. Não reconhecer um cancelamento porque eles trocaram a
    // grafia seria o pior desfecho possível deste `switch`.
    case "canceled":
    case "cancelled":
      return "CANCELED";
    case "paused":
      return "PENDING";
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
      // É o identificador que o suporte deles pede para rastrear uma chamada.
      // Sem guardá-lo, abrir chamado sobre um 400 vira descrição de memória.
      resposta.headers.get("x-request-id") ??
        resposta.headers.get("x-requestid"),
    );
  }

  return corpo as T;
}

function reais(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/**
 * ISO-8601 com deslocamento explícito, como o Mercado Pago exige em
 * `date_of_expiration`.
 *
 * `toISOString()` termina em `Z`, e eles respondem 400 a isso. O deslocamento
 * é o do servidor — em produção, UTC —, o que dá `-00:00` e é aceito.
 */
export function comFuso(data: Date): string {
  const offsetMin = -data.getTimezoneOffset();
  const sinal = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  const local = new Date(data.getTime() + offsetMin * 60_000);

  return (
    `${local.getUTCFullYear()}-${doisDigitos(local.getUTCMonth() + 1)}-` +
    `${doisDigitos(local.getUTCDate())}T${doisDigitos(local.getUTCHours())}:` +
    `${doisDigitos(local.getUTCMinutes())}:${doisDigitos(local.getUTCSeconds())}.` +
    `${String(local.getUTCMilliseconds()).padStart(3, "0")}` +
    `${sinal}${doisDigitos(Math.floor(abs / 60))}:${doisDigitos(abs % 60)}`
  );
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
   * automático. Quem escolhe Pix no mensal não passa por aqui: vai para
   * `criarAssinaturaPix`, que abre a cobrança de um ciclo só e deixa a
   * renovação nas mãos da pessoa. A recusa abaixo continua valendo como
   * guarda — chegar aqui com Pix seria criar um contrato que nunca cobraria.
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
    const pagador = await resolverPagador(entrada.usuario.email);

    const corpo = {
      reason: entrada.plano.nome,
      external_reference: entrada.referenciaExterna,
      // Só o corpo enviado ao provedor muda. `PaymentAttempt.userId`, a
      // assinatura e o direito continuam apontando para a conta real.
      payer_email: pagador.email,
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
      pagadorSubstituido: pagador.substituido,
      bruto: resposta,
    };
  }

  /**
   * Um mês do plano, pago por Pix.
   *
   * `/v1/payments` com `payment_method_id: "pix"` — o mesmo endpoint da compra
   * avulsa, e de propósito: é uma cobrança simples, não um contrato. O que
   * volta é um pagamento consultável em `/v1/payments/<id>`, então webhook,
   * polling, retorno e cron reusam o caminho que já existe e já foi provado em
   * produção.
   *
   * `date_of_expiration` é enviado explicitamente porque o padrão do Mercado
   * Pago é de dias, e um QR que vale até depois de amanhã atrapalha: a pessoa
   * volta ao aplicativo sem saber se ainda deve aquele Pix. Meia hora é o que
   * cabe numa sessão.
   */
  async criarAssinaturaPix(
    entrada: CriarCobrancaPixEntrada,
  ): Promise<RespostaCheckout> {
    const { notificationUrl } = lerCredenciais();
    const pagador = await resolverPagador(entrada.usuario.email);
    const expiraEm = new Date(
      Date.now() + entrada.expiraEmMinutos * 60_000,
    );

    const resposta = await chamar<{
      id: number;
      status: string;
      status_detail?: string;
      date_of_expiration?: string;
      point_of_interaction?: {
        transaction_data?: { qr_code?: string; qr_code_base64?: string };
      };
    }>("/v1/payments", {
      method: "POST",
      idempotencyKey: entrada.idempotencyKey,
      body: JSON.stringify({
        transaction_amount: reais(entrada.plano.precoCents),
        description: entrada.plano.nome,
        payment_method_id: "pix",
        external_reference: entrada.referenciaExterna,
        // O provedor exige o formato com deslocamento; `toISOString` devolve
        // `Z`, que ele recusa em `date_of_expiration`.
        date_of_expiration: comFuso(expiraEm),
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        payer: {
          email: pagador.email,
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
        : expiraEm,
      pagadorSubstituido: pagador.substituido,
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
    const pagador = await resolverPagador(entrada.usuario.email);

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
          email: pagador.email,
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
      pagadorSubstituido: pagador.substituido,
      bruto: resposta,
    };
  }

  /** Cartão: preferência do Checkout Pro, hospedado por eles. */
  private async compraPorCheckout(
    entrada: CriarCompraEntrada,
  ): Promise<RespostaCheckout> {
    const { notificationUrl } = lerCredenciais();
    const pagador = await resolverPagador(entrada.usuario.email);

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
          email: pagador.email,
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
      // `externalId` fica vazio de propósito: ainda não existe pagamento, e
      // carimbar a preferência aqui é exatamente o que fazia a reconsulta
      // bater em `/v1/payments/<preferenceId>` e receber 404.
      externalId: null,
      preferenceId: resposta.id ?? null,
      status: "PENDING",
      checkoutUrl: resposta.init_point ?? resposta.sandbox_init_point ?? null,
      pixQrCode: null,
      pixQrCodeBase64: null,
      expiraEm: null,
      pagadorSubstituido: pagador.substituido,
      bruto: resposta,
    };
  }

  /**
   * Preferência → pedido → pagamentos.
   *
   * O Mercado Pago não deixa consultar uma preferência e obter os pagamentos
   * direto; o caminho é `merchant_orders/search?preference_id=`. Um pedido sem
   * `payments` é o estado normal de quem abriu o checkout e ainda não pagou.
   */
  async resolverPreferencia(
    preferenceId: string,
  ): Promise<ResolucaoDePreferencia | null> {
    try {
      const busca = await chamar<{
        elements?: Array<{
          id?: number | string;
          payments?: Array<{ id?: number | string; status?: string }>;
        }>;
      }>(
        `/merchant_orders/search?preference_id=${encodeURIComponent(preferenceId)}`,
      );

      const pedido = busca.elements?.[0];
      if (!pedido) return null;

      return {
        merchantOrderId: pedido.id != null ? String(pedido.id) : null,
        pagamentoIds: ordenarPagamentos(pedido.payments),
      };
    } catch (erro) {
      if (erro instanceof FalhaDoProvedor && erro.status === 404) return null;
      throw erro;
    }
  }

  async pagamentosDaMerchantOrder(merchantOrderId: string): Promise<string[]> {
    try {
      const pedido = await chamar<{
        payments?: Array<{ id?: number | string; status?: string }>;
      }>(`/merchant_orders/${encodeURIComponent(merchantOrderId)}`);

      return ordenarPagamentos(pedido.payments);
    } catch (erro) {
      if (erro instanceof FalhaDoProvedor && erro.status === 404) return [];
      throw erro;
    }
  }

  /**
   * Consulta o pagamento, mas só quando o id é mesmo de um pagamento.
   *
   * Um pedido pode ter várias tentativas — cartão recusado e depois aprovado.
   * `ordenarPagamentos` põe o aprovado na frente para que a reconciliação
   * decida pelo desfecho que vale, e não pela primeira tentativa que apareceu.
   */
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
        point_of_interaction?: {
          type?: string;
          transaction_data?: { subscription_id?: string };
        };
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
        // Cobrança de assinatura aponta o preapproval que a gerou. Confirmado
        // na API real: `type: "SUBSCRIPTIONS"` e o `subscription_id` igual ao
        // id do preapproval.
        preapprovalId:
          p.point_of_interaction?.transaction_data?.subscription_id ?? null,
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
        summarized?: { charged_quantity?: number | null };
      }>(`/preapproval/${encodeURIComponent(externalId)}`);

      return {
        externalId: a.id,
        status: traduzirStatusAssinatura(a.status ?? null),
        statusCru: a.status ?? null,
        referenciaExterna: a.external_reference ?? null,
        proximaCobranca: a.next_payment_date
          ? new Date(a.next_payment_date)
          : null,
        cobrancasRealizadas: a.summarized?.charged_quantity ?? null,
        bruto: a,
      };
    } catch (erro) {
      if (erro instanceof FalhaDoProvedor && erro.status === 404) return null;
      throw erro;
    }
  }

  /**
   * `GET /authorized_payments/search?preapproval_id=`, página por página.
   *
   * O Mercado Pago devolve 12 por página por padrão. Uma mensal com dois anos
   * já passa disso, e parar na primeira página esconderia exatamente as
   * cobranças mais recentes — as que importam para renovar.
   */
  async listarFaturas(preapprovalId: string): Promise<FaturaDeAssinatura[]> {
    const faturas: FaturaDeAssinatura[] = [];
    // 12 é o teto da API, não uma escolha. Confirmado em produção: `limit=20`
    // e `limit=50` respondem 400 "Invalid value for limit". A primeira versão
    // deste método pedia 50 e teria quebrado toda renovação na primeira
    // chamada real.
    const limite = 12;

    // Teto de segurança: 100 páginas × 12 = 1200 faturas, um século de
    // mensal. Uma resposta que nunca acaba não pode prender o cron.
    for (let pagina = 0; pagina < 100; pagina += 1) {
      const resposta = await chamar<{
        paging?: { total?: number; offset?: number; limit?: number };
        results?: FaturaCrua[];
      }>(
        `/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}` +
          `&offset=${pagina * limite}&limit=${limite}`,
      );

      const lote = Array.isArray(resposta.results) ? resposta.results : [];
      faturas.push(...lote.map(traduzirFatura));

      const total = resposta.paging?.total ?? 0;
      if (lote.length === 0 || faturas.length >= total) break;
    }

    return faturas;
  }

  async consultarFatura(faturaId: string): Promise<FaturaDeAssinatura | null> {
    try {
      const f = await chamar<FaturaCrua>(
        `/authorized_payments/${encodeURIComponent(faturaId)}`,
      );
      return traduzirFatura(f);
    } catch (erro) {
      if (erro instanceof FalhaDoProvedor && erro.status === 404) return null;
      throw erro;
    }
  }

  /**
   * `"cancelled"`, com **dois** L — decidido pela API, não pela documentação.
   *
   * A documentação do Mercado Pago diverge de si mesma: "Gerenciamento de
   * assinaturas → Cancelar ou pausar" e `/preapproval/export` mandam enviar
   * `canceled`, com um L; as páginas de ciclo de vida usam `cancelled`.
   *
   * Quem desempatou foi a própria API, em produção:
   *
   *     PUT /preapproval/<id>  {"status":"canceled"}
   *     → 400  "Invalid preapproval status param: canceled"
   *        x-request-id 40b129c6-ce73-40f1-af44-bed81e05eb5b
   *
   * Ou seja, a página de cancelamento está desatualizada. Para **ler**,
   * `traduzirStatusAssinatura` continua aceitando as duas grafias: não
   * reconhecer um cancelamento vindo deles é pior que tolerar a
   * inconsistência.
   *
   * Errar esta string é caro e silencioso, e custou quatro tentativas reais
   * para ser nomeado. A confirmação obrigatória em
   * `confirmarCancelamentoNoProvedor` é a rede embaixo disso — sem `CANCELED`
   * confirmado, nada é gravado do nosso lado, e foi ela que impediu quatro
   * "cancelamentos" falsos no banco.
   */
  async cancelarAssinatura(externalId: string): Promise<EstadoProvedor> {
    const resposta = await chamar<{ status?: string }>(
      `/preapproval/${encodeURIComponent(externalId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      },
    );

    return traduzirStatusAssinatura(resposta.status ?? null);
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
   * Confere a assinatura HMAC do webhook e separa Webhook de IPN legado.
   *
   * O manifesto é montado exatamente como eles especificam —
   * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — com comparação em
   * tempo constante. A leitura mora em `notificacao.ts`, compartilhada com o
   * mock.
   */
  async lerWebhook(
    corpoCru: string,
    cabecalhos: Headers,
    url: URL,
  ): Promise<WebhookLido> {
    const { webhookSecret } = lerCredenciais();
    return lerNotificacao(corpoCru, cabecalhos, url, webhookSecret);
  }
}
