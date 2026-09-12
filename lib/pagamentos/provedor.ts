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

/**
 * Uma cobrança Pix avulsa que paga **um** ciclo de assinatura.
 *
 * Não é `CriarAssinaturaEntrada` com outro método: ali nasce um preapproval,
 * um objeto que o provedor passa a cobrar sozinho para sempre. Aqui nasce um
 * pagamento e nada mais — o Pix não tem débito automático, e fingir que tem
 * criaria uma assinatura que nunca renovaria. Duas coisas diferentes, dois
 * métodos diferentes.
 *
 * Não existe `urlRetorno`: ninguém sai do aplicativo. A pessoa copia o código,
 * paga no banco e volta — ou nem volta, e o acesso aparece do mesmo jeito.
 */
export type CriarCobrancaPixEntrada = {
  usuario: UsuarioPagante;
  plano: DefinicaoDePlano;
  /** Nosso `PaymentAttempt.id`, devolvido pelo provedor nos webhooks. */
  referenciaExterna: string;
  idempotencyKey: string;
  /** Quanto tempo o QR vale. Curto demais frustra; longo demais confunde. */
  expiraEmMinutos: number;
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
/**
 * O que uma preferência do Checkout Pro virou do lado do provedor.
 *
 * Existe porque preferência, pedido e pagamento são três objetos distintos, e
 * só o último pode ser consultado em `/v1/payments`. Sem este passo, a única
 * forma de descobrir o pagamento era a pessoa voltar pela `back_url` com o
 * `payment_id` na query — e quem fecha a aba nunca volta.
 */
export type ResolucaoDePreferencia = {
  merchantOrderId: string | null;
  /** Ids de pagamento do pedido, do mais recente para o mais antigo. */
  pagamentoIds: string[];
};

export type RespostaCheckout = {
  externalId: string | null;
  /** Checkout Pro: a preferência, que **não** é um id de pagamento. */
  preferenceId?: string | null;
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
  /**
   * Preapproval que gerou esta cobrança, quando é de assinatura. No Mercado
   * Pago vem em `point_of_interaction.transaction_data.subscription_id`, com
   * `point_of_interaction.type = "SUBSCRIPTIONS"`. É o que desvia a cobrança
   * para o livro de ciclos em vez de tratá-la como pagamento solto.
   */
  preapprovalId?: string | null;
  bruto: unknown;
};

export type ConsultaAssinatura = {
  externalId: string;
  status: EstadoProvedor;
  /**
   * Status cru do provedor. `EstadoProvedor` junta `pending` e `paused` em
   * PENDING, e para renovação os dois são opostos: um é quem ainda não
   * autorizou, o outro é quem parou de pagar.
   */
  statusCru?: string | null;
  referenciaExterna: string | null;
  proximaCobranca: Date | null;
  /** `summarized.charged_quantity`: quantas cobranças o provedor diz ter feito. */
  cobrancasRealizadas?: number | null;
  bruto: unknown;
};

/**
 * Uma fatura (`authorized_payment`) de assinatura.
 *
 * Estrutura confirmada contra a API real (preapproval da mensal de teste):
 *
 *   preapproval ──1:N──► fatura 7031821286 ──1:1──► payment 178365984346
 *
 * `GET /v1/payments/<id da fatura>` responde 404: o webhook
 * `subscription_authorized_payment` traz o id **da fatura**, e é daqui que se
 * chega ao pagamento.
 */
export type FaturaDeAssinatura = {
  id: string;
  preapprovalId: string | null;
  statusCru: string | null;
  referenciaExterna: string | null;
  dataDebito: Date | null;
  valorCents: number;
  moeda: string;
  metodo: string | null;
  /** `retry_attempt`: a fatura pode ser cobrada mais de uma vez. */
  retentativa: number | null;
  /** A última cobrança da fatura. Nula enquanto nada foi cobrado. */
  pagamento: {
    id: string;
    status: EstadoProvedor;
    statusCru: string | null;
    detalheCru: string | null;
  } | null;
};

/** Canal da notificação: Webhook assinado ou IPN legado. */
export type FormatoNotificacao = "WEBHOOK" | "IPN";

export type OrigemDoDataId = "query-data.id" | "query-id" | "body-data.id";

/**
 * O que se pode gravar sobre a assinatura sem gravar a assinatura: presença e
 * forma. Nunca o valor de `x-signature`, o `v1` ou o segredo.
 */
export type DiagnosticoNotificacao = {
  formato: FormatoNotificacao;
  hasXSignature: boolean;
  hasXRequestId: boolean;
  signatureHasTs: boolean;
  signatureHasV1: boolean;
  /** Ramo que forneceu o id do manifesto; nulo quando nenhum forneceu. */
  dataIdSource: OrigemDoDataId | null;
  liveMode: boolean | null;
};

/** O que extraímos de um webhook antes de confiar em qualquer coisa. */
export type WebhookLido = {
  formato: FormatoNotificacao;
  /**
   * Assinatura HMAC conferida. Falso não descarta: grava e audita. Em IPN é
   * sempre falso — não há assinatura de Webhook para conferir.
   */
  assinaturaValida: boolean;
  /** Id estável do evento — base da idempotência. */
  eventId: string;
  topico: string;
  acao: string | null;
  /** Recurso citado, para reconsulta. */
  recursoId: string | null;
  payload: unknown;
  diagnostico: DiagnosticoNotificacao;
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

  /**
   * Abre a cobrança Pix de **um** ciclo mensal.
   *
   * O `externalId` que volta daqui é o de um pagamento de verdade — o mesmo
   * que `consultarPagamento` aceita. É essa a diferença que faz a renovação
   * manual funcionar: no preapproval, o id é de um contrato e o ciclo vem das
   * faturas; aqui, o id **é** a cobrança que concede o ciclo.
   */
  criarAssinaturaPix(
    entrada: CriarCobrancaPixEntrada,
  ): Promise<RespostaCheckout>;

  criarCompra(entrada: CriarCompraEntrada): Promise<RespostaCheckout>;

  consultarPagamento(externalId: string): Promise<ConsultaPagamento | null>;

  /**
   * Descobre o pagamento real de uma preferência do Checkout Pro.
   *
   * Devolve `null` quando o provedor não tem nada ainda — a pessoa abriu o
   * checkout e não pagou. Isso é uma resposta legítima, não um erro: quem
   * chamou deve deixar a tentativa como está e tentar de novo depois.
   */
  resolverPreferencia(
    preferenceId: string,
  ): Promise<ResolucaoDePreferencia | null>;

  /** Os pagamentos de um `merchant_order`, do mais recente para o mais antigo. */
  pagamentosDaMerchantOrder(merchantOrderId: string): Promise<string[]>;

  consultarAssinatura(externalId: string): Promise<ConsultaAssinatura | null>;

  /**
   * Todas as faturas de um preapproval, percorrendo a paginação inteira.
   * É a fonte de verdade da renovação: o que foi cobrado, recusado ou ainda
   * não aconteceu, independente de algum webhook ter chegado.
   */
  listarFaturas(preapprovalId: string): Promise<FaturaDeAssinatura[]>;

  /** Uma fatura por id — o que `subscription_authorized_payment` entrega. */
  consultarFatura(faturaId: string): Promise<FaturaDeAssinatura | null>;

  /**
   * Cancela a assinatura no provedor e devolve **o estado que ele confirmou**.
   *
   * Devolver `void` era o problema: sem resposta não havia como saber se o
   * cancelamento pegou, e o chamador gravava "cancelada" localmente na fé. Se
   * a chamada falhasse, nosso banco dizia uma coisa e o provedor seguia
   * cobrando.
   */
  cancelarAssinatura(externalId: string): Promise<EstadoProvedor>;

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
    /** `x-request-id` do provedor: o que o suporte deles pede para investigar. */
    public readonly requestId?: string | null,
  ) {
    super(message);
    this.name = "FalhaDoProvedor";
  }
}

/**
 * O que um erro do provedor pode contar sem contar demais.
 *
 * Campos escolhidos a dedo, e não o corpo inteiro. Guardar a resposta crua
 * numa tabela de auditoria é como esse tipo de log vaza identificador de
 * conta, e-mail do pagador ou os quatro últimos do cartão — dados que não
 * ajudam a diagnosticar e que passam a viver num lugar que muita gente lê.
 *
 * O motivo de existir: um 400 sem corpo é indiagnosticável. A primeira
 * tentativa real de cancelamento gravou apenas "respondeu 400", e a
 * investigação parou aí, sem conseguir dizer **por quê**.
 */
export type FalhaSanitizada = {
  httpStatus: number | null;
  /** Descrição do provedor. Ex.: "Invalid preapproval status". */
  message: string | null;
  /** Classe do erro. Ex.: "bad_request". */
  error: string | null;
  /** Código do provedor, quando vem no topo. */
  code: string | number | null;
  /** Status que o provedor devolveu no corpo — nem sempre igual ao HTTP. */
  status: string | number | null;
  /** `cause` do Mercado Pago: lista de `{ code, description }`. */
  cause: Array<{ code: string | number | null; description: string | null }>;
  requestId: string | null;
};

/** Corta textos longos: log de auditoria não é lugar para página inteira. */
function texto(valor: unknown, limite = 300): string | null {
  if (typeof valor === "string") return valor.slice(0, limite);
  if (typeof valor === "number") return String(valor);
  return null;
}

function escalar(valor: unknown): string | number | null {
  if (typeof valor === "string") return valor.slice(0, 120);
  if (typeof valor === "number") return valor;
  return null;
}

/**
 * Extrai de um erro qualquer a parte que pode ser registrada.
 *
 * Aceita `unknown` de propósito: o chamador está num `catch`, e o que chega
 * ali pode ser um `FalhaDoProvedor`, um `TypeError` de rede, ou o
 * `TimeoutError` do `AbortSignal`. Todos viram a mesma forma.
 */
export function sanitizarFalha(erro: unknown): FalhaSanitizada {
  const vazio: FalhaSanitizada = {
    httpStatus: null,
    message: null,
    error: null,
    code: null,
    status: null,
    cause: [],
    requestId: null,
  };

  if (!(erro instanceof FalhaDoProvedor)) {
    // Rede, timeout, JSON quebrado: só a mensagem, que aqui é nossa ou do
    // runtime — nunca conteúdo do provedor.
    return {
      ...vazio,
      message: erro instanceof Error ? texto(erro.message) : texto(String(erro)),
    };
  }

  const corpo =
    erro.corpo && typeof erro.corpo === "object"
      ? (erro.corpo as Record<string, unknown>)
      : null;

  const causas = Array.isArray(corpo?.cause) ? corpo.cause : [];

  return {
    httpStatus: erro.status ?? null,
    // O corpo do provedor tem precedência: "Invalid status" diz muito mais que
    // o nosso "respondeu 400 em /preapproval/...".
    message: texto(corpo?.message) ?? texto(erro.message),
    error: texto(corpo?.error, 120),
    code: escalar(corpo?.code),
    status: escalar(corpo?.status),
    cause: causas.slice(0, 5).map((c) => {
      const item = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
      return {
        code: escalar(item.code),
        description: texto(item.description),
      };
    }),
    requestId: erro.requestId ?? null,
  };
}
