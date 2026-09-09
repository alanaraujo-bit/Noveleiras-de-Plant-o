/**
 * Contrato do provedor de pagamento.
 *
 * Todo o resto da aplicação fala com esta interface e nunca com o Mercado
 * Pago diretamente. Não é abstração por gosto: a camada comercial (planos,
 * direitos, webhooks, telas) precisa existir e ser testável *antes* das
 * credenciais chegarem, e trocar de adquirente depois não pode significar
 * reescrever regra de negócio.
 *
 * Duas escolhas que valem explicação:
 *
 * - **`referenciaExterna` é obrigatória em toda cobrança.** É o nosso id de
 *   tentativa viajando dentro do objeto do provedor. Sem ele, um webhook
 *   chega dizendo "pagamento 123 aprovado" e não há como saber a quem
 *   pertence sem uma busca frágil por valor e data.
 *
 * - **`consultar*` existe separado do webhook.** O corpo de um webhook nunca
 *   autoriza mudança de estado: ele só diz "algo mudou no recurso X". Quem
 *   decide é a releitura autenticada do recurso.
 */

import type { DefinicaoDePlano } from "./planos";

export type MetodoPagamento = "CARD" | "PIX";

/**
 * Estado normalizado. Cada provedor tem o seu vocabulário; a aplicação
 * conhece só este.
 */
export type EstadoProvedor =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "REFUNDED"
  | "CHARGEBACK"
  | "EXPIRED"
  | "UNKNOWN";

export type UsuarioPagante = {
  id: string;
  email: string;
  nome: string;
};

export type CriarAssinaturaEntrada = {
  usuario: UsuarioPagante;
  plano: DefinicaoDePlano;
  metodo: MetodoPagamento;
  /** Nosso `PaymentAttempt.id`, devolvido pelo provedor nos webhooks. */
  referenciaExterna: string;
  idempotencyKey: string;
  /** Para onde o provedor devolve a pessoa depois do checkout. */
  urlRetorno: string;
};

export type CriarCompraEntrada = {
  usuario: UsuarioPagante;
  novela: { id: string; slug: string; titulo: string };
  valorCents: number;
  metodo: MetodoPagamento;
  referenciaExterna: string;
  idempotencyKey: string;
  urlRetorno: string;
};

/** O que o provedor devolve ao abrir uma cobrança. */
export type RespostaCheckout = {
  externalId: string | null;
  status: EstadoProvedor;
  /** Checkout hospedado, quando o fluxo é por redirecionamento. */
  checkoutUrl: string | null;
  /** Copia-e-cola do Pix, quando o método é Pix. */
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
  expiraEm: Date | null;
  /**
   * O pagador enviado ao provedor foi substituído por um comprador de teste.
   *
   * Existe para que a cobrança nasça marcada como demonstração: dinheiro de
   * usuário de teste não é receita, e sem esta marca ele entraria no MRR do
   * painel misturado com faturamento de verdade.
   */
  pagadorSubstituido?: boolean;
  /** Resposta crua, guardada para auditoria. */
  bruto: unknown;
};

export type ConsultaPagamento = {
  externalId: string;
  status: EstadoProvedor;
  valorCents: number;
  moeda: string;
  metodo: string | null;
  referenciaExterna: string | null;
  aprovadoEm: Date | null;
  reembolsadoCents: number;
  /** Motivo da recusa, como o provedor descreveu. */
  statusCru: string | null;
  detalheCru: string | null;
  bruto: unknown;
};

export type ConsultaAssinatura = {
  externalId: string;
  status: EstadoProvedor;
  referenciaExterna: string | null;
  proximaCobranca: Date | null;
  bruto: unknown;
};

/** O que extraímos de um webhook antes de confiar em qualquer coisa. */
export type WebhookLido = {
  /** Assinatura HMAC conferida. Falso não descarta: grava e audita. */
  assinaturaValida: boolean;
  /** Id estável do evento — base da idempotência. */
  eventId: string;
  topico: string;
  acao: string | null;
  /** Recurso citado, para reconsulta. */
  recursoId: string | null;
  payload: unknown;
};

export type ResultadoReembolso = {
  externalId: string | null;
  status: EstadoProvedor;
  valorCents: number;
  bruto: unknown;
};

export interface ProvedorDePagamento {
  /** Gravado em `Payment.provider`. Ex.: "mercadopago", "mock". */
  readonly nome: string;

  /** O provedor tem tudo que precisa para operar de verdade? */
  readonly configurado: boolean;

  criarAssinatura(
    entrada: CriarAssinaturaEntrada,
  ): Promise<RespostaCheckout>;

  criarCompra(entrada: CriarCompraEntrada): Promise<RespostaCheckout>;

  consultarPagamento(externalId: string): Promise<ConsultaPagamento | null>;

  consultarAssinatura(externalId: string): Promise<ConsultaAssinatura | null>;

  cancelarAssinatura(externalId: string): Promise<void>;

  reembolsar(
    externalId: string,
    valorCents?: number,
  ): Promise<ResultadoReembolso>;

  /**
   * Valida e interpreta um webhook.
   *
   * Recebe corpo cru (string) porque a assinatura HMAC é calculada sobre
   * bytes: reserializar o JSON mudaria espaços e ordem de chaves e quebraria
   * a conferência.
   */
  lerWebhook(
    corpoCru: string,
    cabecalhos: Headers,
    url: URL,
  ): Promise<WebhookLido>;
}

/** Erro de configuração — credencial ausente, não falha de rede. */
export class ProvedorNaoConfigurado extends Error {
  constructor(public readonly faltando: string[]) {
    super(
      `Provedor de pagamento sem credenciais. Faltam: ${faltando.join(", ")}. ` +
        "Veja docs/mercado-pago.md.",
    );
    this.name = "ProvedorNaoConfigurado";
  }
}

/** Falha vinda do provedor (HTTP não-2xx, resposta inesperada). */
export class FalhaDoProvedor extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly corpo?: unknown,
  ) {
    super(message);
    this.name = "FalhaDoProvedor";
  }
}
