/**
 * A compra avulsa sobrevivendo ao Checkout Pro.
 *
 * O bug que estes testes existem para impedir: `criarCompra` devolvia o id da
 * **preferência** e ele era gravado como se fosse o id do **pagamento**.
 * Reconsultar `/v1/payments/<preferenceId>` responde 404, a reconciliação
 * devolvia "pagamento inexistente" e a compra paga não liberava nada — em
 * silêncio. A tela de espera girava para sempre, e o webhook de
 * `merchant_order`, que traz o id do pedido, batia no mesmo 404 e ainda era
 * gravado como PROCESSED.
 *
 * São três objetos e só um decide: preferência → merchant order → payment.
 * `reconciliarCompra` percorre esse caminho; o que se prova aqui é que ela
 * chega ao pagamento certo por qualquer porta, e que percorrer duas vezes não
 * cria uma segunda `Payment`, `Purchase` nem `Entitlement`.
 *
 * O duplo de banco sabe errar de propósito: `create` sempre acrescenta linha.
 * Uma concessão duplicada apareceria como duas linhas e derrubaria o teste.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsultaPagamento, ResolucaoDePreferencia } from "./provedor";

// ------------------------------------------------------------ banco falso

type Linha = Record<string, unknown>;

const tabelas = {
  paymentAttempt: [] as Linha[],
  purchase: [] as Linha[],
  payment: [] as Linha[],
  entitlement: [] as Linha[],
  refund: [] as Linha[],
  subscription: [] as Linha[],
  subscriptionEvent: [] as Linha[],
};

/** Coluna que ninguém escreveu é NULL no Postgres, não `undefined`. */
function casa(linha: Linha, where: Linha | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, valor]) => {
    if (valor && typeof valor === "object" && "in" in (valor as Linha)) {
      return ((valor as { in: unknown[] }).in ?? []).includes(linha[campo]);
    }
    if (valor === null) return linha[campo] == null;
    return linha[campo] === valor;
  });
}

let sequencia = 0;
const novoId = (prefixo: string) => `${prefixo}-${++sequencia}`;

function tabela(nome: keyof typeof tabelas) {
  const linhas = () => tabelas[nome];
  return {
    findUnique: async ({ where }: { where: Linha }) =>
      linhas().find((l) => casa(l, where)) ?? null,
    findFirst: async ({ where }: { where?: Linha } = {}) =>
      linhas().find((l) => casa(l, where)) ?? null,
    create: async ({ data }: { data: Linha }) => {
      const linha = { id: novoId(nome), ...data };
      linhas().push(linha);
      return linha;
    },
    update: async ({ where, data }: { where: Linha; data: Linha }) => {
      const linha = linhas().find((l) => casa(l, where));
      if (!linha) throw new Error(`${nome}: linha inexistente`);
      Object.assign(linha, data);
      return linha;
    },
    updateMany: async ({ where, data }: { where?: Linha; data: Linha }) => {
      const alvos = linhas().filter((l) => casa(l, where));
      alvos.forEach((l) => Object.assign(l, data));
      return { count: alvos.length };
    },
  };
}

const bancoFalso = {
  paymentAttempt: tabela("paymentAttempt"),
  purchase: tabela("purchase"),
  payment: tabela("payment"),
  entitlement: tabela("entitlement"),
  refund: tabela("refund"),
  subscription: tabela("subscription"),
  subscriptionEvent: tabela("subscriptionEvent"),
  $transaction: async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => Promise<unknown>)(bancoFalso)
      : await Promise.all(arg as Promise<unknown>[]),
};

vi.mock("@/lib/db", () => ({ db: bancoFalso }));

/** `lib/painel/log` e `server-only`, que nao resolve no ambiente de teste. */
vi.mock("@/lib/painel/log", () => ({
  log: { info: () => {}, warn: () => {}, error: () => {} },
}));

// -------------------------------------------------------- provedor falso

const PREFERENCIA = "pref-abc";
const MERCHANT_ORDER = "mo-777";
const PAGAMENTO = "pay-999";
const ATTEMPT = "attempt-compra-1";
const USUARIO = "user-real-noveleiras";
const NOVELA = "novela-alvo";
const OUTRA_NOVELA = "novela-outra";

/** O que o provedor conhece. Cada teste monta o seu. */
let pagamentos: Record<string, ConsultaPagamento> = {};
let pedidos: Record<string, string[]> = {};
let preferencias: Record<string, ResolucaoDePreferencia> = {};

const chamadas = { consultarPagamento: [] as string[], resolverPreferencia: 0 };

vi.mock("./index", () => ({
  podeUsarMock: () => false,
  provedorDePagamento: () => ({
    nome: "mercadopago",
    consultarPagamento: async (id: string) => {
      chamadas.consultarPagamento.push(id);
      return pagamentos[id] ?? null;
    },
    resolverPreferencia: async (id: string) => {
      chamadas.resolverPreferencia += 1;
      return preferencias[id] ?? null;
    },
    pagamentosDaMerchantOrder: async (id: string) => pedidos[id] ?? [],
  }),
}));

const { reconciliarCompra, reconciliarMerchantOrder } = await import(
  "./servico"
);

// ------------------------------------------------------------- cenários

function pagamentoAprovado(
  over: Partial<ConsultaPagamento> = {},
): ConsultaPagamento {
  return {
    externalId: PAGAMENTO,
    status: "APPROVED",
    valorCents: 499,
    moeda: "BRL",
    metodo: "credit_card",
    referenciaExterna: ATTEMPT,
    aprovadoEm: new Date("2026-09-10T20:00:00Z"),
    reembolsadoCents: 0,
    statusCru: "approved",
    detalheCru: null,
    bruto: {},
    ...over,
  };
}

function semear() {
  tabelas.paymentAttempt = [
    {
      id: ATTEMPT,
      userId: USUARIO,
      kind: "PURCHASE",
      status: "PENDING",
      plan: null,
      novelaId: NOVELA,
      purchaseId: "purchase-1",
      amountCents: 499,
      method: "card",
      provider: "mercadopago",
      // O ponto inteiro: nasce SEM pagamento, só com a preferência.
      externalId: null,
      externalPreferenceId: PREFERENCIA,
      externalMerchantOrderId: null,
      isDemo: true,
    },
  ];
  tabelas.purchase = [
    {
      id: "purchase-1",
      userId: USUARIO,
      novelaId: NOVELA,
      status: "PENDING",
      amountCents: 499,
      externalPreferenceId: PREFERENCIA,
      isDemo: true,
    },
  ];
  tabelas.payment = [];
  tabelas.entitlement = [];
  tabelas.refund = [];
  tabelas.subscription = [];
  tabelas.subscriptionEvent = [];

  pagamentos = { [PAGAMENTO]: pagamentoAprovado() };
  pedidos = { [MERCHANT_ORDER]: [PAGAMENTO] };
  preferencias = {
    [PREFERENCIA]: { merchantOrderId: MERCHANT_ORDER, pagamentoIds: [PAGAMENTO] },
  };
  chamadas.consultarPagamento = [];
  chamadas.resolverPreferencia = 0;
}

const tentativa = () => tabelas.paymentAttempt[0]!;
const compra = () => tabelas.purchase[0]!;
const direitosAtivos = () =>
  tabelas.entitlement.filter((e) => e.status === "ACTIVE");

beforeEach(semear);

/** O desfecho que interessa, verificado inteiro. */
function esperarCompraLiberada() {
  expect(tentativa().status).toBe("APPROVED");
  expect(tentativa().externalId).toBe(PAGAMENTO);
  expect(compra().status).toBe("PAID");

  expect(tabelas.payment).toHaveLength(1);
  expect(tabelas.payment[0]!.kind).toBe("TITLE_PURCHASE");
  // Compra avulsa não pertence a plano nenhum.
  expect(tabelas.payment[0]!.plan).toBeNull();

  expect(direitosAtivos()).toHaveLength(1);
  const direito = direitosAtivos()[0]!;
  expect(direito.kind).toBe("TITLE_PURCHASE");
  expect(direito.novelaId).toBe(NOVELA);
  expect(direito.userId).toBe(USUARIO);
  // Permanente: compra de obra não expira.
  expect(direito.endsAt).toBeNull();
}

describe("retorno do Checkout Pro", () => {
  it("com payment_id na URL, usa o pagamento direto", async () => {
    const r = await reconciliarCompra(ATTEMPT, PAGAMENTO);

    expect(r.attemptId).toBe(ATTEMPT);
    esperarCompraLiberada();
    // Caminho mais barato: não gastou ida ao provedor para descobrir nada.
    expect(chamadas.resolverPreferencia).toBe(0);
  });

  it("sem payment_id, resolve pela preferência", async () => {
    const r = await reconciliarCompra(ATTEMPT, null);

    expect(r.attemptId).toBe(ATTEMPT);
    esperarCompraLiberada();
    expect(chamadas.resolverPreferencia).toBe(1);
    // E nunca consultou a preferência como se fosse pagamento.
    expect(chamadas.consultarPagamento).not.toContain(PREFERENCIA);
  });

  it("guarda o merchant order descoberto para a próxima vez", async () => {
    await reconciliarCompra(ATTEMPT, null);
    expect(tentativa().externalMerchantOrderId).toBe(MERCHANT_ORDER);
  });
});

describe("a pessoa fecha a aba do Mercado Pago e nunca volta", () => {
  it("o polling recupera a compra sozinho, pelo preferenceId", async () => {
    // Ninguém passou pela back_url: nenhum payment_id em lugar nenhum.
    expect(tentativa().externalId).toBeNull();
    expect(direitosAtivos()).toHaveLength(0);

    // A tela de espera consulta.
    const r = await reconciliarCompra(ATTEMPT);

    expect(r.attemptId).toBe(ATTEMPT);
    esperarCompraLiberada();
  });

  it("enquanto não pagou, não inventa nada e deixa a tentativa em paz", async () => {
    // Pedido existe, mas ainda sem pagamento: é quem abriu e não pagou.
    preferencias[PREFERENCIA] = {
      merchantOrderId: MERCHANT_ORDER,
      pagamentoIds: [],
    };
    pedidos[MERCHANT_ORDER] = [];

    const r = await reconciliarCompra(ATTEMPT);

    expect(r.mudou).toBe(false);
    expect(r.status).toBe("PENDING");
    expect(tentativa().status).toBe("PENDING");
    expect(tabelas.payment).toHaveLength(0);
    expect(direitosAtivos()).toHaveLength(0);
  });

  it("preferência que o provedor não conhece não quebra a tela", async () => {
    preferencias = {};

    const r = await reconciliarCompra(ATTEMPT);

    expect(r.mudou).toBe(false);
    expect(tentativa().status).toBe("PENDING");
    expect(direitosAtivos()).toHaveLength(0);
  });
});

describe("webhook de merchant_order", () => {
  it("resolve os pagamentos do pedido e concilia", async () => {
    const r = await reconciliarMerchantOrder(MERCHANT_ORDER);

    expect(r.mudou).toBe(true);
    expect(r.attemptId).toBe(ATTEMPT);
    esperarCompraLiberada();
    expect(tentativa().externalMerchantOrderId).toBe(MERCHANT_ORDER);
  });

  it("pedido sem pagamento ainda não conta como tratado", async () => {
    pedidos[MERCHANT_ORDER] = [];

    const r = await reconciliarMerchantOrder(MERCHANT_ORDER);

    // `mudou: false` vira IGNORED no WebhookEvent. Marcar PROCESSED aqui
    // faria a auditoria afirmar que algo foi conciliado quando nada foi.
    expect(r.mudou).toBe(false);
    expect(r.attemptId).toBeNull();
    expect(tabelas.payment).toHaveLength(0);
    expect(direitosAtivos()).toHaveLength(0);
  });

  it("nunca consulta o id do pedido como se fosse pagamento", async () => {
    await reconciliarMerchantOrder(MERCHANT_ORDER);
    expect(chamadas.consultarPagamento).not.toContain(MERCHANT_ORDER);
  });

  it("cartão recusado antes do aprovado não marca a compra como recusada", async () => {
    const recusado = "pay-recusado";
    pagamentos[recusado] = pagamentoAprovado({
      externalId: recusado,
      status: "REJECTED",
      statusCru: "rejected",
    });
    // O provedor entrega ordenado: aprovado primeiro.
    pedidos[MERCHANT_ORDER] = [PAGAMENTO, recusado];

    await reconciliarMerchantOrder(MERCHANT_ORDER);

    esperarCompraLiberada();
  });
});

describe("idempotência entre todos os caminhos", () => {
  it("retorno e depois polling não duplicam nada", async () => {
    await reconciliarCompra(ATTEMPT, PAGAMENTO);
    await reconciliarCompra(ATTEMPT);

    expect(tabelas.payment).toHaveLength(1);
    expect(tabelas.purchase).toHaveLength(1);
    expect(direitosAtivos()).toHaveLength(1);
  });

  it("polling e depois webhook não duplicam nada", async () => {
    await reconciliarCompra(ATTEMPT);
    await reconciliarMerchantOrder(MERCHANT_ORDER);

    expect(tabelas.payment).toHaveLength(1);
    expect(direitosAtivos()).toHaveLength(1);
  });

  it("merchant_order e payment sobre a mesma compra não duplicam nada", async () => {
    await reconciliarMerchantOrder(MERCHANT_ORDER);
    await reconciliarCompra(ATTEMPT, PAGAMENTO);

    expect(tabelas.payment).toHaveLength(1);
    expect(direitosAtivos()).toHaveLength(1);
  });

  it("webhook reentregue quatro vezes deixa exatamente um de cada", async () => {
    for (let i = 0; i < 4; i += 1) {
      await reconciliarCompra(ATTEMPT, PAGAMENTO);
    }

    expect(tabelas.payment).toHaveLength(1);
    expect(tabelas.entitlement).toHaveLength(1);
    expect(compra().status).toBe("PAID");
  });

  it("compra já concedida antes: reconciliar não cria um segundo direito", async () => {
    // O direito já existe — outra entrega chegou primeiro.
    tabelas.entitlement.push({
      id: "direito-existente",
      userId: USUARIO,
      novelaId: NOVELA,
      kind: "TITLE_PURCHASE",
      status: "ACTIVE",
      source: "PURCHASE",
      purchaseId: "purchase-1",
      startsAt: new Date("2026-09-10T19:00:00Z"),
      endsAt: null,
    });

    await reconciliarCompra(ATTEMPT, PAGAMENTO);

    expect(direitosAtivos()).toHaveLength(1);
    expect(direitosAtivos()[0]!.id).toBe("direito-existente");
  });
});

describe("o que a compra não faz", () => {
  it("não libera outra novela", async () => {
    await reconciliarCompra(ATTEMPT, PAGAMENTO);

    const liberadas = direitosAtivos().map((d) => d.novelaId);
    expect(liberadas).toEqual([NOVELA]);
    expect(liberadas).not.toContain(OUTRA_NOVELA);
  });

  it("não cria nem mexe em assinatura", async () => {
    await reconciliarCompra(ATTEMPT, PAGAMENTO);

    expect(tabelas.subscription).toHaveLength(0);
    expect(tabelas.subscriptionEvent).toHaveLength(0);
  });

  it("tentativa inexistente não explode nem inventa dono", async () => {
    const r = await reconciliarCompra("nao-existe", PAGAMENTO);

    expect(r.mudou).toBe(false);
    expect(r.attemptId).toBeNull();
    expect(tabelas.payment).toHaveLength(0);
  });
});
