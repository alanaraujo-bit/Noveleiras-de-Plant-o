/**
 * Renovação: uma cobrança real concede no máximo um ciclo.
 *
 * O que estes testes impedem, cada um com nome:
 *
 * - o primeiro pagamento, chegando depois da ativação, ganhar um segundo ciclo;
 * - a reentrega do mesmo pagamento estender o período de novo;
 * - a mesma recusa, entregue três vezes, cortar quem teve um cartão recusado;
 * - um pagamento antigo desfazer o cancelamento de quem pediu para sair;
 * - `subscription_authorized_payment` ir para `/v1/payments/<fatura>` (404);
 * - passagens concorrentes concederem o mesmo mês duas vezes.
 *
 * O banco é um duplo em memória que **impõe as duas unicidades do `Payment`**
 * — `(provider, externalId)` e `(subscriptionId, cycleIndex)` — e responde
 * `P2002` como o Postgres. As leituras cedem a vez com `setImmediate`, então
 * passagens concorrentes realmente se intercalam: as duas leem "não existe"
 * antes de qualquer uma gravar. Um duplo que aceitasse tudo passaria os
 * testes sem provar nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { carteiraDe } from "@/lib/access/entitlements";

import { fimDoCiclo, PLANO_ANUAL, PLANO_MENSAL } from "./planos";
import type {
  ConsultaAssinatura,
  ConsultaPagamento,
  EstadoProvedor,
  FaturaDeAssinatura,
} from "./provedor";

// ------------------------------------------------------------ banco falso

type Linha = Record<string, unknown>;

const tabelas = {
  paymentAttempt: [] as Linha[],
  subscription: [] as Linha[],
  payment: [] as Linha[],
  entitlement: [] as Linha[],
  subscriptionEvent: [] as Linha[],
};

const pausa = () => new Promise<void>((r) => setImmediate(r));

function casaValor(atual: unknown, esperado: unknown): boolean {
  if (esperado === null) return atual == null;
  if (esperado instanceof Date) {
    return atual instanceof Date && atual.getTime() === esperado.getTime();
  }
  if (esperado && typeof esperado === "object") {
    const e = esperado as Record<string, unknown>;
    if ("not" in e) return !casaValor(atual, e.not);
    if ("in" in e) return (e.in as unknown[]).includes(atual);
    if ("gt" in e) return typeof atual === "number" && atual > (e.gt as number);
    if ("lte" in e) {
      return atual instanceof Date && atual.getTime() <= (e.lte as Date).getTime();
    }
  }
  return atual === esperado;
}

function casa(linha: Linha, where: Linha | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, valor]) =>
    casaValor(linha[campo], valor),
  );
}

function aplicar(linha: Linha, data: Linha) {
  for (const [campo, valor] of Object.entries(data)) {
    if (valor && typeof valor === "object" && "increment" in (valor as Linha)) {
      linha[campo] =
        ((linha[campo] as number) ?? 0) + ((valor as { increment: number }).increment);
    } else {
      linha[campo] = valor;
    }
  }
}

function conflito(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

let sequencia = 0;

/** Gancho para forçar uma corrida de ciclo num ponto exato. */
let antesDeCriarPagamento: ((data: Linha) => void) | null = null;

function tabela(nome: keyof typeof tabelas) {
  const linhas = () => tabelas[nome];
  return {
    findUnique: async ({ where }: { where: Linha }) => {
      await pausa();
      return linhas().find((l) => casa(l, where)) ?? null;
    },
    findFirst: async ({
      where,
      orderBy,
    }: { where?: Linha; orderBy?: Record<string, "asc" | "desc"> } = {}) => {
      await pausa();
      const achadas = linhas().filter((l) => casa(l, where));
      if (orderBy) {
        const [campo, sentido] = Object.entries(orderBy)[0]!;
        achadas.sort((a, b) => {
          const d = (a[campo] as number) - (b[campo] as number);
          return sentido === "desc" ? -d : d;
        });
      }
      return achadas[0] ?? null;
    },
    count: async ({ where }: { where?: Linha } = {}) => {
      await pausa();
      return linhas().filter((l) => casa(l, where)).length;
    },
    create: async ({ data }: { data: Linha }) => {
      if (nome === "payment") {
        antesDeCriarPagamento?.(data);
        const todas = linhas();
        if (
          data.externalId != null &&
          todas.some((p) => p.provider === data.provider && p.externalId === data.externalId)
        ) {
          throw conflito();
        }
        if (
          data.subscriptionId != null &&
          data.cycleIndex != null &&
          todas.some(
            (p) => p.subscriptionId === data.subscriptionId && p.cycleIndex === data.cycleIndex,
          )
        ) {
          throw conflito();
        }
      }
      const padroes: Linha =
        nome === "payment"
          ? { cycleIndex: null, invoiceId: null, periodStart: null, periodEnd: null }
          : nome === "subscription"
            ? {
                externalPreapprovalId: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                canceledAt: null,
                failedCharges: 0,
                graceUntil: null,
              }
            : {};
      const linha = { id: `${nome}-${++sequencia}`, ...padroes, ...data };
      linhas().push(linha);
      return linha;
    },
    update: async ({ where, data }: { where: Linha; data: Linha }) => {
      const linha = linhas().find((l) => casa(l, where));
      if (!linha) throw new Error(`${nome}: linha inexistente`);
      aplicar(linha, data);
      return linha;
    },
    updateMany: async ({ where, data }: { where?: Linha; data: Linha }) => {
      const alvos = linhas().filter((l) => casa(l, where));
      alvos.forEach((l) => aplicar(l, data));
      return { count: alvos.length };
    },
  };
}

const bancoFalso = {
  paymentAttempt: tabela("paymentAttempt"),
  subscription: tabela("subscription"),
  payment: tabela("payment"),
  entitlement: tabela("entitlement"),
  subscriptionEvent: tabela("subscriptionEvent"),
  $transaction: async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => Promise<unknown>)(bancoFalso)
      : await Promise.all(arg as Promise<unknown>[]),
};

vi.mock("@/lib/db", () => ({ db: bancoFalso }));
vi.mock("@/lib/painel/log", () => ({
  log: { info: () => {}, warn: () => {}, error: () => {} },
}));

// -------------------------------------------------------- provedor falso

const PRE = "f85556784fc649ee87071a78cf19fe8c";
const ATT = "cmtw1tn150049l504fdowcjvl";
const USUARIO = "cmtw592cx0002l5041itzkbhp";

/** O que o provedor responde agora. Cada teste monta o seu. */
const provedor = {
  preapprovals: {} as Record<string, ConsultaAssinatura>,
  faturas: {} as Record<string, FaturaDeAssinatura[]>,
  pagamentos: {} as Record<string, ConsultaPagamento>,
  pagamentosConsultados: [] as string[],
};

vi.mock("./index", () => ({
  podeUsarMock: () => false,
  provedorDePagamento: () => ({
    nome: "mercadopago",
    consultarAssinatura: async (id: string) => provedor.preapprovals[id] ?? null,
    listarFaturas: async (id: string) => [...(provedor.faturas[id] ?? [])],
    consultarFatura: async (id: string) =>
      Object.values(provedor.faturas).flat().find((f) => f.id === id) ?? null,
    consultarPagamento: async (id: string) => {
      provedor.pagamentosConsultados.push(id);
      return provedor.pagamentos[id] ?? null;
    },
  }),
}));

const {
  reconciliarCicloDeAssinatura,
  reconciliarFatura,
  reconciliarPagamento,
} = await import("./servico");

// ------------------------------------------------------------ montagem

const D1 = new Date("2026-09-10T21:38:07.000Z");
const D2 = new Date("2026-10-10T21:38:07.000Z");

function preapproval(
  id: string,
  referencia: string,
  statusCru = "authorized",
  cobrancas: number | null = null,
): ConsultaAssinatura {
  const status: EstadoProvedor =
    statusCru === "authorized"
      ? "APPROVED"
      : statusCru === "cancelled" || statusCru === "canceled"
        ? "CANCELED"
        : "PENDING";
  return {
    externalId: id,
    status,
    statusCru,
    referenciaExterna: referencia,
    proximaCobranca: null,
    cobrancasRealizadas: cobrancas,
    bruto: {},
  };
}

function fatura(
  id: string,
  pagamentoId: string | null,
  status: EstadoProvedor,
  debito: Date,
  opcoes: { pre?: string; valor?: number } = {},
): FaturaDeAssinatura {
  return {
    id,
    preapprovalId: opcoes.pre ?? PRE,
    statusCru: "processed",
    referenciaExterna: ATT,
    dataDebito: debito,
    valorCents: opcoes.valor ?? 999,
    moeda: "BRL",
    metodo: "account_money",
    retentativa: 1,
    pagamento: pagamentoId
      ? {
          id: pagamentoId,
          status,
          statusCru: status === "APPROVED" ? "approved" : "rejected",
          detalheCru: status === "APPROVED" ? "accredited" : "cc_rejected_insufficient_amount",
        }
      : null,
  };
}

/** A fatura e o pagamento reais da mensal de teste, como a API devolveu. */
const F1 = () => fatura("7031821286", "178365984346", "APPROVED", D1);
const F2 = () => fatura("7031821287", "pay-ciclo-2", "APPROVED", D2);

function tentativa(over: Linha = {}): Linha {
  return {
    id: ATT,
    userId: USUARIO,
    kind: "SUBSCRIPTION",
    status: "PENDING",
    plan: "MONTHLY",
    provider: "mercadopago",
    externalId: PRE,
    isDemo: true,
    createdAt: new Date("2026-09-10T21:37:57.977Z"),
    ...over,
  };
}

/** A novela comprada à parte: nada nesta suíte pode encostar nela. */
const TITULO = {
  id: "direito-titulo",
  userId: USUARIO,
  kind: "TITLE_PURCHASE",
  status: "ACTIVE",
  novelaId: "cmts9o8im03n6hoyg0pqyhxxi",
  subscriptionId: null,
  purchaseId: "compra-1",
  startsAt: new Date("2026-09-10T23:16:43.802Z"),
  endsAt: null,
  revokedAt: null,
};
const PAGAMENTO_TITULO = {
  id: "pagamento-titulo",
  userId: USUARIO,
  kind: "TITLE_PURCHASE",
  plan: null,
  status: "APPROVED",
  provider: "mercadopago",
  externalId: "178386070986",
  subscriptionId: null,
  cycleIndex: null,
  invoiceId: null,
  amountCents: 499,
};

function semearGratuita(over: Linha = {}) {
  tabelas.subscription = [
    {
      id: "sub-1",
      userId: USUARIO,
      plan: "FREE",
      status: "ACTIVE",
      provider: "interno",
      externalPreapprovalId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      failedCharges: 0,
      graceUntil: null,
      startedAt: new Date("2026-09-07T03:14:07.992Z"),
      ...over,
    },
  ];
}

beforeEach(() => {
  tabelas.paymentAttempt = [tentativa()];
  semearGratuita();
  tabelas.payment = [{ ...PAGAMENTO_TITULO }];
  tabelas.entitlement = [{ ...TITULO }];
  tabelas.subscriptionEvent = [];

  provedor.preapprovals = { [PRE]: preapproval(PRE, ATT) };
  provedor.faturas = { [PRE]: [F1()] };
  provedor.pagamentos = {
    "178365984346": {
      externalId: "178365984346",
      status: "APPROVED",
      valorCents: 999,
      moeda: "BRL",
      metodo: "account_money",
      referenciaExterna: ATT,
      aprovadoEm: D1,
      reembolsadoCents: 0,
      statusCru: "approved",
      detalheCru: "accredited",
      preapprovalId: PRE,
      bruto: {},
    },
  };
  provedor.pagamentosConsultados = [];
  antesDeCriarPagamento = null;
});

const ciclos = () =>
  tabelas.payment
    .filter((p) => p.cycleIndex != null)
    .sort((a, b) => (a.cycleIndex as number) - (b.cycleIndex as number));
const assinatura = () => tabelas.subscription[0]!;
const direitosDeAssinatura = () =>
  tabelas.entitlement.filter(
    // Coluna nunca escrita é NULL no Postgres; aqui chega como undefined.
    (e) => e.status === "ACTIVE" && e.novelaId == null,
  );
const eventos = (tipo?: string) =>
  tabelas.subscriptionEvent.filter((e) => !tipo || e.type === tipo);

const reconciliar = (origem = "teste") =>
  reconciliarCicloDeAssinatura(PRE, { origem });
const reconciliarOutro = (pre: string) =>
  reconciliarCicloDeAssinatura(pre, { origem: "teste" });

function esperarTituloIntacto() {
  const direito = tabelas.entitlement.find((e) => e.id === "direito-titulo")!;
  expect(direito).toMatchObject({
    kind: "TITLE_PURCHASE",
    status: "ACTIVE",
    endsAt: null,
    revokedAt: null,
    subscriptionId: null,
  });
  const pagamento = tabelas.payment.find((p) => p.id === "pagamento-titulo")!;
  expect(pagamento).toMatchObject({ subscriptionId: null, cycleIndex: null, status: "APPROVED" });
}

// ------------------------------------------------------------ ativação

describe("ativação da mensal", () => {
  it("o primeiro pagamento vira o ciclo 1", async () => {
    const r = await reconciliar();

    const fim = fimDoCiclo(PLANO_MENSAL, D1);
    expect(r.ciclosNovos).toBe(1);
    expect(ciclos()).toHaveLength(1);
    expect(ciclos()[0]).toMatchObject({
      cycleIndex: 1,
      externalId: "178365984346",
      invoiceId: "7031821286",
      subscriptionId: "sub-1",
      status: "APPROVED",
      periodStart: D1,
      periodEnd: fim,
    });
    expect(assinatura()).toMatchObject({
      plan: "MONTHLY",
      status: "ACTIVE",
      externalPreapprovalId: PRE,
      currentPeriodEnd: fim,
    });
    expect(direitosDeAssinatura()).toHaveLength(1);
    expect(direitosDeAssinatura()[0]).toMatchObject({ kind: "SUBSCRIPTION_MONTHLY", endsAt: fim });
    expect(eventos("ACTIVATED")).toHaveLength(1);
    esperarTituloIntacto();
  });

  it("a tentativa original fica aprovada e continua guardando o preapproval", async () => {
    await reconciliar();
    expect(tabelas.paymentAttempt[0]).toMatchObject({ status: "APPROVED", externalId: PRE });
  });

  it("preapproval autorizado sem cobrança ainda não concede nada", async () => {
    provedor.faturas[PRE] = [fatura("7031821286", null, "PENDING", D1)];

    const r = await reconciliar();

    expect(r.ciclosNovos).toBe(0);
    expect(ciclos()).toHaveLength(0);
    expect(assinatura().plan).toBe("FREE");
    expect(tabelas.paymentAttempt[0]!.status).toBe("PENDING");
  });
});

describe("o primeiro pagamento chegando depois da ativação", () => {
  it("pelo webhook de payment: não cria ciclo 2", async () => {
    await reconciliar("retorno");
    const antes = assinatura().currentPeriodEnd;

    await reconciliarPagamento("178365984346");

    expect(ciclos()).toHaveLength(1);
    expect(assinatura().currentPeriodEnd).toEqual(antes);
    expect(eventos()).toHaveLength(1);
  });

  it("por subscription_authorized_payment realista: vai pela fatura, nunca por /v1/payments/<fatura>", async () => {
    await reconciliar("retorno");

    const r = await reconciliarFatura("7031821286");

    expect(r.attemptId).toBe(ATT);
    expect(ciclos()).toHaveLength(1);
    expect(provedor.pagamentosConsultados).not.toContain("7031821286");
  });

  it("webhook de payment de assinatura não sobrescreve a tentativa original", async () => {
    await reconciliar();
    await reconciliarPagamento("178365984346");
    expect(tabelas.paymentAttempt[0]!.externalId).toBe(PRE);
  });
});

describe("o mesmo pagamento entregue várias vezes", () => {
  it("por todas as portas, deixa exatamente um ciclo", async () => {
    await reconciliar("retorno");
    const fim = assinatura().currentPeriodEnd;

    for (let i = 0; i < 4; i += 1) {
      await reconciliar("polling");
      await reconciliarPagamento("178365984346");
      await reconciliarFatura("7031821286");
    }

    expect(ciclos()).toHaveLength(1);
    expect(assinatura().currentPeriodEnd).toEqual(fim);
    expect(direitosDeAssinatura()[0]!.endsAt).toEqual(fim);
    expect(eventos()).toHaveLength(1);
  });
});

// ----------------------------------------------------------- renovações

describe("renovação", () => {
  it("dois ciclos diferentes: um mês por cobrança, encadeado", async () => {
    provedor.faturas[PRE] = [F1(), F2()];

    await reconciliar();

    const fim1 = fimDoCiclo(PLANO_MENSAL, D1);
    const fim2 = fimDoCiclo(PLANO_MENSAL, fim1);
    expect(ciclos().map((c) => c.externalId)).toEqual(["178365984346", "pay-ciclo-2"]);
    expect(ciclos()[1]).toMatchObject({ cycleIndex: 2, periodStart: fim1, periodEnd: fim2 });
    expect(assinatura().currentPeriodEnd).toEqual(fim2);
    expect(eventos("ACTIVATED")).toHaveLength(1);
    expect(eventos("RENEWED")).toHaveLength(1);
  });

  it("fora de ordem: a API devolvendo o ciclo 2 primeiro não troca os ciclos", async () => {
    provedor.faturas[PRE] = [F2(), F1()];

    await reconciliar();

    expect(ciclos().map((c) => c.externalId)).toEqual(["178365984346", "pay-ciclo-2"]);
  });

  it("o ciclo 2 aparecendo numa passagem posterior encadeia no fim do ciclo 1, não na data de hoje", async () => {
    await reconciliar();
    provedor.faturas[PRE] = [F1(), F2()];
    await reconciliar();

    const fim1 = fimDoCiclo(PLANO_MENSAL, D1);
    expect(ciclos()[1]!.periodStart).toEqual(fim1);
    expect(assinatura().currentPeriodEnd).toEqual(fimDoCiclo(PLANO_MENSAL, fim1));
  });
});

describe("anual", () => {
  it("ativa por doze meses e renova por mais doze", async () => {
    tabelas.paymentAttempt = [tentativa({ plan: "ANNUAL" })];
    provedor.faturas[PRE] = [
      fatura("fat-a1", "pay-a1", "APPROVED", D1, { valor: 9990 }),
    ];

    await reconciliar();

    const fim1 = fimDoCiclo(PLANO_ANUAL, D1);
    expect(fim1.getUTCFullYear()).toBe(2027);
    expect(assinatura()).toMatchObject({ plan: "ANNUAL", currentPeriodEnd: fim1 });
    expect(direitosDeAssinatura()[0]).toMatchObject({ kind: "SUBSCRIPTION_ANNUAL", endsAt: fim1 });

    provedor.faturas[PRE]!.push(
      fatura("fat-a2", "pay-a2", "APPROVED", fim1, { valor: 9990 }),
    );
    await reconciliar();
    await reconciliar();

    expect(ciclos()).toHaveLength(2);
    expect(assinatura().currentPeriodEnd).toEqual(fimDoCiclo(PLANO_ANUAL, fim1));
    esperarTituloIntacto();
  });
});

// --------------------------------------------------------------- recusas

describe("cobrança recusada", () => {
  const R2a = () => fatura("7031821287", "pay-2-recusado", "REJECTED", D2);
  const R2b = () =>
    fatura("7031821287", "pay-2-aprovado", "APPROVED", new Date(D2.getTime() + 86_400_000));

  it("a mesma recusa entregue três vezes conta uma vez e não corta ninguém", async () => {
    provedor.faturas[PRE] = [F1(), R2a()];

    await reconciliar();
    await reconciliar();
    await reconciliar();

    const fim1 = fimDoCiclo(PLANO_MENSAL, D1);
    expect(assinatura().failedCharges).toBe(1);
    expect(tabelas.payment.filter((p) => p.status === "FAILED")).toHaveLength(1);
    expect(eventos("PAYMENT_FAILED")).toHaveLength(1);
    expect(assinatura().status).toBe("ACTIVE");
    // Tolerância fixa a partir do fim do ciclo pago.
    expect(assinatura().graceUntil).toEqual(new Date(fim1.getTime() + 3 * 86_400_000));
    expect(direitosDeAssinatura()).toHaveLength(1);
  });

  it("a tolerância mantém o acesso até o fim, e só até o fim", async () => {
    provedor.faturas[PRE] = [F1(), R2a()];
    await reconciliar();

    const fim1 = fimDoCiclo(PLANO_MENSAL, D1);
    const sub = assinatura() as never;
    const direitos = direitosDeAssinatura().map((d) => ({
      kind: d.kind as "SUBSCRIPTION_MONTHLY",
      novelaId: null,
      startsAt: d.startsAt as Date,
      endsAt: d.endsAt as Date,
    }));
    const dia = 86_400_000;

    expect(carteiraDe(sub, direitos, new Date(fim1.getTime() + dia)).premium).toBe(true);
    expect(carteiraDe(sub, direitos, new Date(fim1.getTime() + 4 * dia)).premium).toBe(false);
  });

  it("retentativa aprovada da mesma fatura renova e zera a contagem", async () => {
    provedor.faturas[PRE] = [F1(), R2a()];
    await reconciliar();
    expect(assinatura().failedCharges).toBe(1);

    provedor.faturas[PRE] = [F1(), R2a(), R2b()];
    await reconciliar();

    expect(ciclos()).toHaveLength(2);
    expect(ciclos()[1]!.externalId).toBe("pay-2-aprovado");
    expect(assinatura()).toMatchObject({ failedCharges: 0, graceUntil: null, status: "ACTIVE" });
  });

  it("recusa antiga chegando depois de a fatura ter sido paga não conta", async () => {
    provedor.faturas[PRE] = [F1(), R2b()];
    await reconciliar();

    provedor.faturas[PRE] = [F1(), R2b(), R2a()];
    await reconciliar();

    expect(assinatura().failedCharges).toBe(0);
    expect(assinatura().graceUntil).toBeNull();
    expect(eventos("PAYMENT_FAILED")).toHaveLength(0);
  });
});

describe("pausado no provedor", () => {
  it("vira PAST_DUE sem revogar, e o acesso acaba por data", async () => {
    await reconciliar();
    provedor.preapprovals[PRE] = preapproval(PRE, ATT, "paused");

    await reconciliar();
    await reconciliar();

    const fim1 = fimDoCiclo(PLANO_MENSAL, D1);
    expect(assinatura().status).toBe("PAST_DUE");
    expect(eventos("PAST_DUE")).toHaveLength(1);
    expect(direitosDeAssinatura()).toHaveLength(1);

    const sub = assinatura() as never;
    const dia = 86_400_000;
    expect(carteiraDe(sub, [], new Date(fim1.getTime() - dia)).premium).toBe(true);
    expect(carteiraDe(sub, [], new Date(fim1.getTime() + 2 * dia)).premium).toBe(true);
    expect(carteiraDe(sub, [], new Date(fim1.getTime() + 4 * dia)).premium).toBe(false);
  });
});

// ---------------------------------------------------------- cancelamento

describe("cancelamento", () => {
  function cancelarLocalmente() {
    Object.assign(assinatura(), {
      cancelAtPeriodEnd: true,
      canceledAt: new Date("2026-09-11T00:20:18.373Z"),
    });
  }

  it("um pagamento antigo reentregue não desfaz o cancelamento", async () => {
    await reconciliar();
    cancelarLocalmente();

    await reconciliar();
    await reconciliarPagamento("178365984346");

    expect(assinatura()).toMatchObject({
      cancelAtPeriodEnd: true,
      canceledAt: new Date("2026-09-11T00:20:18.373Z"),
    });
  });

  it("nem uma cobrança nova do mesmo preapproval desfaz", async () => {
    await reconciliar();
    cancelarLocalmente();
    provedor.faturas[PRE] = [F1(), F2()];

    await reconciliar();

    expect(ciclos()).toHaveLength(2);
    expect(assinatura().cancelAtPeriodEnd).toBe(true);
  });

  it("cancelamento feito no provedor é descoberto, marcado uma vez e não corta acesso", async () => {
    await reconciliar();
    provedor.preapprovals[PRE] = preapproval(PRE, ATT, "cancelled");

    await Promise.all([reconciliar(), reconciliar(), reconciliar()]);

    expect(assinatura().cancelAtPeriodEnd).toBe(true);
    expect(assinatura().status).toBe("ACTIVE");
    expect(eventos("CANCELED")).toHaveLength(1);
    expect(direitosDeAssinatura()).toHaveLength(1);
    esperarTituloIntacto();
  });

  it("só um preapproval NOVO, de uma assinatura nova, limpa o cancelamento", async () => {
    await reconciliar();
    cancelarLocalmente();

    const PRE2 = "pre-novo";
    tabelas.paymentAttempt.push(
      tentativa({ id: "att-novo", externalId: PRE2, createdAt: new Date("2026-09-20T12:00:00Z") }),
    );
    provedor.preapprovals[PRE2] = preapproval(PRE2, "att-novo");
    provedor.faturas[PRE2] = [
      { ...fatura("fat-novo", "pay-novo", "APPROVED", new Date("2026-09-20T12:00:05Z"), { pre: PRE2 }), referenciaExterna: "att-novo" },
    ];

    await reconciliarOutro(PRE2);

    expect(assinatura()).toMatchObject({
      externalPreapprovalId: PRE2,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });
  });

  it("um preapproval antigo, pago depois, registra a receita mas nunca estende", async () => {
    await reconciliar();
    const fim = assinatura().currentPeriodEnd;

    const VELHO = "pre-velho";
    tabelas.paymentAttempt.push(
      tentativa({ id: "att-velho", externalId: VELHO, createdAt: new Date("2026-09-10T20:36:40Z") }),
    );
    provedor.preapprovals[VELHO] = preapproval(VELHO, "att-velho");
    provedor.faturas[VELHO] = [
      { ...fatura("fat-velho", "pay-velho", "APPROVED", D2, { pre: VELHO }), referenciaExterna: "att-velho" },
    ];

    await reconciliarOutro(VELHO);

    const velho = tabelas.payment.find((p) => p.externalId === "pay-velho")!;
    expect(velho).toMatchObject({ status: "APPROVED", cycleIndex: null });
    expect(assinatura()).toMatchObject({ externalPreapprovalId: PRE, currentPeriodEnd: fim });
  });
});

// ------------------------------------------------------------ concorrência

describe("concorrência", () => {
  it("cinco passagens simultâneas do mesmo pagamento: um ciclo, um evento", async () => {
    await Promise.all([
      reconciliar("webhook"),
      reconciliar("polling"),
      reconciliar("retorno"),
      reconciliarPagamento("178365984346"),
      reconciliarFatura("7031821286"),
    ]);

    expect(ciclos()).toHaveLength(1);
    expect(eventos("ACTIVATED")).toHaveLength(1);
    expect(direitosDeAssinatura()).toHaveLength(1);
    expect(assinatura().currentPeriodEnd).toEqual(fimDoCiclo(PLANO_MENSAL, D1));
  });

  it("passagens simultâneas com dois ciclos: exatamente dois, na ordem certa", async () => {
    provedor.faturas[PRE] = [F1(), F2()];

    await Promise.all([reconciliar(), reconciliar(), reconciliar(), reconciliar()]);

    expect(ciclos().map((c) => [c.cycleIndex, c.externalId])).toEqual([
      [1, "178365984346"],
      [2, "pay-ciclo-2"],
    ]);
    expect(eventos()).toHaveLength(2);
  });

  it("perdendo a corrida pelo ciclo, relê e fica com o próximo — sem estourar erro", async () => {
    await reconciliar();
    const fim1 = fimDoCiclo(PLANO_MENSAL, D1);
    const fimFantasma = fimDoCiclo(PLANO_MENSAL, fim1);

    // Outra cobrança grava o ciclo 2 no instante exato em que esta ia gravar.
    let disparou = false;
    antesDeCriarPagamento = (data) => {
      if (!disparou && data.cycleIndex === 2) {
        disparou = true;
        tabelas.payment.push({
          id: "pagamento-concorrente",
          provider: "mercadopago",
          externalId: "pay-concorrente",
          subscriptionId: "sub-1",
          cycleIndex: 2,
          status: "APPROVED",
          periodStart: fim1,
          periodEnd: fimFantasma,
        });
        throw conflito();
      }
    };
    provedor.faturas[PRE] = [F1(), F2()];

    await reconciliar();

    const nosso = tabelas.payment.find((p) => p.externalId === "pay-ciclo-2")!;
    expect(disparou).toBe(true);
    expect(nosso).toMatchObject({ cycleIndex: 3, periodStart: fimFantasma });
  });
});

// ----------------------------------------------- assinaturas já existentes

describe("assinatura ativada antes do livro de ciclos", () => {
  const INICIO = new Date("2026-09-10T22:23:13.365Z");
  const FIM = new Date("2026-10-10T22:23:13.365Z");

  beforeEach(() => {
    tabelas.paymentAttempt = [tentativa({ status: "APPROVED" })];
    semearGratuita({
      plan: "MONTHLY",
      provider: "mercadopago",
      externalPreapprovalId: PRE,
      currentPeriodStart: INICIO,
      currentPeriodEnd: FIM,
    });
    tabelas.entitlement.push({
      id: "direito-mensal",
      userId: USUARIO,
      kind: "SUBSCRIPTION_MONTHLY",
      status: "ACTIVE",
      novelaId: null,
      subscriptionId: "sub-1",
      startsAt: INICIO,
      endsAt: FIM,
      revokedAt: null,
    });
  });

  it("sem autorização, nenhuma porta escreve nada", async () => {
    const r1 = await reconciliar("webhook:preapproval");
    const r2 = await reconciliarPagamento("178365984346");
    const r3 = await reconciliarFatura("7031821286");

    for (const r of [r1, r2, r3]) {
      expect(r).toMatchObject({ vinculoLegadoPendente: true, mudou: false });
    }
    expect(ciclos()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
    expect(assinatura()).toMatchObject({ currentPeriodStart: INICIO, currentPeriodEnd: FIM });
  });

  it("nem o cancelamento feito no provedor é gravado antes da migração", async () => {
    provedor.preapprovals[PRE] = preapproval(PRE, ATT, "cancelled");
    await reconciliar();
    expect(assinatura().cancelAtPeriodEnd).toBe(false);
  });

  it("vínculo autorizado: o pagamento vira o ciclo 1 sem mover data nenhuma", async () => {
    Object.assign(assinatura(), { cancelAtPeriodEnd: true, canceledAt: new Date("2026-09-11T00:20:18Z") });

    const r = await reconciliarCicloDeAssinatura(PRE, {
      origem: "migracao",
      permitirVinculoLegado: true,
    });

    expect(r.ciclosNovos).toBe(1);
    expect(ciclos()).toHaveLength(1);
    expect(ciclos()[0]).toMatchObject({
      cycleIndex: 1,
      externalId: "178365984346",
      invoiceId: "7031821286",
      periodStart: INICIO,
      periodEnd: FIM,
    });
    expect(assinatura()).toMatchObject({
      currentPeriodStart: INICIO,
      currentPeriodEnd: FIM,
      cancelAtPeriodEnd: true,
    });
    expect(direitosDeAssinatura()[0]!.endsAt).toEqual(FIM);
    expect(eventos()).toHaveLength(0);
    esperarTituloIntacto();
  });

  it("vínculo repetido é idempotente", async () => {
    const opcoes = { origem: "migracao", permitirVinculoLegado: true };
    await reconciliarCicloDeAssinatura(PRE, opcoes);
    await reconciliarCicloDeAssinatura(PRE, opcoes);
    expect(ciclos()).toHaveLength(1);
    expect(assinatura().currentPeriodEnd).toEqual(FIM);
  });

  it("depois do vínculo, a renovação encadeia no fim do ciclo 1 que já estava pago", async () => {
    await reconciliarCicloDeAssinatura(PRE, { origem: "migracao", permitirVinculoLegado: true });
    provedor.faturas[PRE] = [F1(), F2()];

    await reconciliar();

    expect(ciclos()[1]).toMatchObject({ cycleIndex: 2, periodStart: FIM });
    expect(assinatura().currentPeriodEnd).toEqual(fimDoCiclo(PLANO_MENSAL, FIM));
  });
});

// ---------------------------------------------------- compra à parte

describe("TITLE_PURCHASE", () => {
  it("atravessa ativação, renovação, recusa, pausa e cancelamento sem ser tocado", async () => {
    provedor.faturas[PRE] = [F1()];
    await reconciliar();
    provedor.faturas[PRE] = [F1(), fatura("7031821287", "pay-r", "REJECTED", D2)];
    await reconciliar();
    provedor.faturas[PRE] = [F1(), F2()];
    await reconciliar();
    provedor.preapprovals[PRE] = preapproval(PRE, ATT, "paused");
    await reconciliar();
    provedor.preapprovals[PRE] = preapproval(PRE, ATT, "cancelled");
    await reconciliar();

    esperarTituloIntacto();
    // E nunca conta como ciclo.
    expect(ciclos().every((c) => c.kind === "SUBSCRIPTION")).toBe(true);
  });
});

// ------------------------------------------- contrato real da paginação

/**
 * `listarFaturas` contra as regras que a API real impõe.
 *
 * A primeira versão pedia `limit=50`. O Mercado Pago responde 400
 * "Invalid value for limit" para qualquer coisa acima de 12 — descoberto numa
 * consulta de leitura antes do deploy. Com provedor falso nenhum teste
 * pegaria isso, então o duplo aqui recusa exatamente como a API recusa.
 */
describe("listarFaturas contra o contrato da API", () => {
  it("pagina de 12 em 12 por offset e traduz o formato real", async () => {
    const { MercadoPago } = await import("./mercadopago");
    const originais = { ...process.env };
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "segredo";

    const total = 25;
    const pedidos: URL[] = [];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = new URL(String(url));
      pedidos.push(u);
      const limit = Number(u.searchParams.get("limit") ?? 12);
      if (limit > 12) {
        return new Response(JSON.stringify({ message: "Invalid value for limit" }), {
          status: 400,
        });
      }
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const quantos = Math.max(0, Math.min(limit, total - offset));
      const results = Array.from({ length: quantos }, (_, i) => ({
        id: 7031821286 + offset + i,
        preapproval_id: PRE,
        type: "recurring",
        status: "processed",
        external_reference: ATT,
        debit_date: "2026-09-10T17:38:07.000-04:00",
        transaction_amount: 9.99,
        currency_id: "BRL",
        retry_attempt: 1,
        payment: {
          id: 178365984346 + offset + i,
          status: "approved",
          status_detail: "accredited",
        },
      }));
      return new Response(JSON.stringify({ paging: { offset, limit, total }, results }), {
        status: 200,
      });
    }) as typeof fetch;

    try {
      const faturas = await new MercadoPago().listarFaturas(PRE);

      expect(faturas).toHaveLength(25);
      expect(pedidos).toHaveLength(3);
      for (const u of pedidos) {
        expect(u.pathname).toBe("/authorized_payments/search");
        expect(Number(u.searchParams.get("limit"))).toBeLessThanOrEqual(12);
      }
      expect(pedidos.map((u) => u.searchParams.get("offset"))).toEqual(["0", "12", "24"]);
      expect(faturas[0]).toMatchObject({
        id: "7031821286",
        preapprovalId: PRE,
        referenciaExterna: ATT,
        valorCents: 999,
        pagamento: { id: "178365984346", status: "APPROVED", statusCru: "approved" },
      });
    } finally {
      globalThis.fetch = fetchOriginal;
      process.env = originais;
    }
  });
});

// ------------------------------------------------------ chave do cron

describe("ASSINATURAS_RECONCILIAR", () => {
  it("aceita 1, true e sim; qualquer outra coisa deixa desligada", async () => {
    const { reconciliacaoLigada } = await import("./cron");
    const original = process.env.ASSINATURAS_RECONCILIAR;

    try {
      // `true` é o valor que qualquer um escreveria — e a primeira versão, que
      // só aceitava "1", o ignorava em silêncio.
      for (const v of ["1", "true", "TRUE", " sim "]) {
        process.env.ASSINATURAS_RECONCILIAR = v;
        expect(reconciliacaoLigada()).toBe(true);
      }
      for (const v of ["0", "false", "", "ligado"]) {
        process.env.ASSINATURAS_RECONCILIAR = v;
        expect(reconciliacaoLigada()).toBe(false);
      }
      delete process.env.ASSINATURAS_RECONCILIAR;
      expect(reconciliacaoLigada()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.ASSINATURAS_RECONCILIAR;
      else process.env.ASSINATURAS_RECONCILIAR = original;
    }
  });
});
