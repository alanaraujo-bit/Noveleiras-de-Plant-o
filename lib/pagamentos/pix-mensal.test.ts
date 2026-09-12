/**
 * Mensal por Pix: um pagamento aprovado concede no máximo um mês.
 *
 * O que cada teste daqui impede, com nome:
 *
 * - o mesmo `paymentId` reentregue conceder um segundo mês;
 * - duas passagens simultâneas (webhook + tela + cron) concederem duas vezes;
 * - renovar antes do vencimento custar dias;
 * - pagar dentro da carência ganhar dias que ninguém prometeu;
 * - a carência virar assinatura de graça depois que acaba;
 * - uma novela comprada avulso sumir quando a assinatura acaba;
 * - alguém pagar Pix enquanto o cartão continua cobrando sozinho;
 * - o acesso depender de a pessoa ficar com a tela aberta.
 *
 * O banco é um duplo em memória que **impõe as duas unicidades do `Payment`**
 * — `(provider, externalId)` e `(subscriptionId, cycleIndex)` — e responde
 * `P2002` como o Postgres. As leituras cedem a vez com `setImmediate`, então
 * duas passagens realmente se intercalam: as duas leem "não existe" antes de
 * qualquer uma gravar. Um duplo permissivo passaria nos testes sem provar nada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { carteiraDe } from "@/lib/access/entitlements";

import { CARENCIA_MANUAL_MS } from "./ciclo";
import type { ConsultaPagamento, EstadoProvedor } from "./provedor";

// ------------------------------------------------------------ banco falso

type Linha = Record<string, unknown>;

const tabelas = {
  user: [] as Linha[],
  paymentAttempt: [] as Linha[],
  subscription: [] as Linha[],
  payment: [] as Linha[],
  entitlement: [] as Linha[],
  subscriptionEvent: [] as Linha[],
};

const pausa = () => new Promise<void>((r) => setImmediate(r));

const num = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));

function casaValor(atual: unknown, esperado: unknown): boolean {
  if (esperado === null) return atual == null;
  if (esperado instanceof Date) {
    return atual instanceof Date && atual.getTime() === esperado.getTime();
  }
  if (esperado && typeof esperado === "object" && !Array.isArray(esperado)) {
    return Object.entries(esperado as Record<string, unknown>).every(([op, v]) => {
      switch (op) {
        case "not": return !casaValor(atual, v);
        case "in": return (v as unknown[]).includes(atual);
        case "notIn": return !(v as unknown[]).includes(atual);
        case "gt": return atual != null && num(atual) > num(v);
        case "gte": return atual != null && num(atual) >= num(v);
        case "lt": return atual != null && num(atual) < num(v);
        case "lte": return atual != null && num(atual) <= num(v);
        default: throw new Error(`duplo: operador nao suportado ${op}`);
      }
    });
  }
  return atual === esperado;
}

function casa(linha: Linha, where: Linha | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, valor]) => {
    if (campo === "OR") return (valor as Linha[]).some((w) => casa(linha, w));
    if (campo === "AND") return (valor as Linha[]).every((w) => casa(linha, w));
    return casaValor(linha[campo], valor);
  });
}

function aplicar(linha: Linha, data: Linha) {
  for (const [campo, valor] of Object.entries(data)) {
    if (valor && typeof valor === "object" && "increment" in (valor as Linha)) {
      linha[campo] =
        ((linha[campo] as number) ?? 0) + (valor as { increment: number }).increment;
    } else {
      linha[campo] = valor;
    }
  }
}

function conflito(): Error {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

let sequencia = 0;

/** Gancho para forçar uma corrida num ponto exato. */
let antesDeCriarPagamento: ((data: Linha) => void) | null = null;

const PADROES: Partial<Record<keyof typeof tabelas, Linha>> = {
  payment: {
    cycleIndex: null,
    invoiceId: null,
    periodStart: null,
    periodEnd: null,
    billingMode: null,
    refundedCents: 0,
  },
  subscription: {
    billingMode: "AUTO_RENEW",
    externalPreapprovalId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    failedCharges: 0,
    graceUntil: null,
    trialEndsAt: null,
    startedAt: new Date(0),
  },
  entitlement: {
    novelaId: null,
    endsAt: null,
    purchaseId: null,
    subscriptionId: null,
    revokedAt: null,
    reason: null,
  },
  paymentAttempt: {
    billingMode: null,
    externalId: null,
    externalPreferenceId: null,
    externalMerchantOrderId: null,
    pixQrCode: null,
    pixQrCodeBase64: null,
    expiresAt: null,
    purchaseId: null,
    novelaId: null,
    isDemo: false,
  },
};

function tabela(nome: keyof typeof tabelas) {
  const linhas = () => tabelas[nome];
  return {
    findUnique: async ({ where }: { where: Linha }) => {
      await pausa();
      return linhas().find((l) => casa(l, where)) ?? null;
    },
    findUniqueOrThrow: async ({ where }: { where: Linha }) => {
      await pausa();
      const achada = linhas().find((l) => casa(l, where));
      if (!achada) throw new Error(`${nome}: linha inexistente`);
      return achada;
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
          const d = num(a[campo]) - num(b[campo]);
          return sentido === "desc" ? -d : d;
        });
      }
      return achadas[0] ?? null;
    },
    findMany: async ({
      where,
      take,
      skip,
      cursor,
    }: {
      where?: Linha;
      take?: number;
      skip?: number;
      cursor?: { id: string };
    } = {}) => {
      await pausa();
      const todas = linhas()
        .filter((l) => casa(l, where))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const inicio = cursor
        ? todas.findIndex((l) => l.id === cursor.id) + (skip ?? 0)
        : (skip ?? 0);
      return todas.slice(inicio, take === undefined ? undefined : inicio + take);
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
          todas.some(
            (p) => p.provider === data.provider && p.externalId === data.externalId,
          )
        ) {
          throw conflito();
        }
        if (
          data.subscriptionId != null &&
          data.cycleIndex != null &&
          todas.some(
            (p) =>
              p.subscriptionId === data.subscriptionId &&
              p.cycleIndex === data.cycleIndex,
          )
        ) {
          throw conflito();
        }
      }
      // O índice único parcial de `Entitlement`: um direito de assinatura
      // ativo por pessoa. É a rede final contra acesso duplicado.
      if (nome === "entitlement" && data.status === "ACTIVE" && data.novelaId == null) {
        if (
          linhas().some(
            (e) => e.userId === data.userId && e.status === "ACTIVE" && e.novelaId == null,
          )
        ) {
          throw conflito();
        }
      }
      const linha = {
        id: `${nome}-${++sequencia}`,
        createdAt: new Date(),
        ...(PADROES[nome] ?? {}),
        ...data,
      };
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
  user: tabela("user"),
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
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

// -------------------------------------------------------- provedor falso

const USUARIO = "cmtw592cx0002l5041itzkbhp";

const provedor = {
  pagamentos: {} as Record<string, ConsultaPagamento>,
  criados: [] as Array<{ referencia: string; expiraEmMinutos: number }>,
  proximoPix: "pix-1",
};

vi.mock("./index", () => ({
  podeUsarMock: () => false,
  provedorDePagamento: () => ({
    nome: "mercadopago",
    consultarPagamento: async (id: string) => provedor.pagamentos[id] ?? null,
    criarAssinaturaPix: async (entrada: {
      referenciaExterna: string;
      expiraEmMinutos: number;
    }) => {
      provedor.criados.push({
        referencia: entrada.referenciaExterna,
        expiraEmMinutos: entrada.expiraEmMinutos,
      });
      return {
        externalId: provedor.proximoPix,
        status: "PENDING" as EstadoProvedor,
        checkoutUrl: null,
        pixQrCode: `000201${provedor.proximoPix}5802BR`,
        pixQrCodeBase64: "iVBORw0KGgo=",
        expiraEm: new Date(Date.now() + entrada.expiraEmMinutos * 60_000),
        bruto: {},
      };
    },
  }),
}));

const {
  cancelarAssinaturaDoUsuario,
  expirarAssinaturasVencidas,
  iniciarAssinaturaPix,
  marcarVencimentosManuais,
  reconciliarPagamento,
  reconciliarPixPendentes,
} = await import("./servico");

// ------------------------------------------------------------- montagem

function dia(ano: number, mes: number, d: number, hora = 12): Date {
  return new Date(ano, mes - 1, d, hora, 0, 0, 0);
}

function pagamento(
  id: string,
  referencia: string,
  status: EstadoProvedor,
  aprovadoEm: Date | null,
): ConsultaPagamento {
  return {
    externalId: id,
    status,
    valorCents: 999,
    moeda: "BRL",
    metodo: "pix",
    referenciaExterna: referencia,
    aprovadoEm,
    reembolsadoCents: 0,
    statusCru: status.toLowerCase(),
    detalheCru: null,
    preapprovalId: null,
    bruto: {},
  };
}

/** Abre a cobrança e devolve o id da tentativa. */
async function gerarPix(pixId: string): Promise<string> {
  provedor.proximoPix = pixId;
  const { attemptId } = await iniciarAssinaturaPix({
    userId: USUARIO,
    plano: "MONTHLY",
  });
  return attemptId;
}

/** O provedor passa a dizer que aquele Pix foi pago, na data informada. */
function aprovarNoProvedor(pixId: string, quando: Date) {
  const atual = provedor.pagamentos[pixId]!;
  provedor.pagamentos[pixId] = { ...atual, status: "APPROVED", aprovadoEm: quando };
}

function registrarPendente(pixId: string, attemptId: string) {
  provedor.pagamentos[pixId] = pagamento(pixId, attemptId, "PENDING", null);
}

function assinatura() {
  return tabelas.subscription[0]!;
}

function carteira(agora: Date) {
  const s = assinatura();
  return carteiraDe(
    {
      plan: s.plan as never,
      status: s.status as never,
      trialEndsAt: null,
      currentPeriodEnd: s.currentPeriodEnd as Date | null,
      graceUntil: s.graceUntil as Date | null,
    },
    tabelas.entitlement
      .filter((e) => e.status === "ACTIVE")
      .map((e) => ({
        kind: e.kind as never,
        novelaId: (e.novelaId as string | null) ?? null,
        startsAt: e.startsAt as Date,
        endsAt: (e.endsAt as Date | null) ?? null,
      })),
    agora,
  );
}

/** Ciclos concedidos, para provar que ninguém ganhou mês em dobro. */
function ciclos() {
  return tabelas.payment.filter(
    (p) => p.cycleIndex != null && p.status === "APPROVED",
  );
}

beforeEach(() => {
  for (const nome of Object.keys(tabelas) as Array<keyof typeof tabelas>) {
    tabelas[nome].length = 0;
  }
  sequencia = 0;
  antesDeCriarPagamento = null;
  provedor.pagamentos = {};
  provedor.criados = [];
  tabelas.user.push({
    id: USUARIO,
    email: "ana@exemplo.com",
    name: "Ana",
  });
  // Só o relógio é falso. `setImmediate` precisa continuar real: é ele que faz
  // as leituras do banco duplo cederem a vez, e é dessa intercalação que os
  // testes de concorrência tiram o valor deles.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- testes

describe("primeira assinatura mensal via Pix", () => {
  it("um Pix aprovado libera exatamente um mês, a partir do pagamento", async () => {
    vi.setSystemTime(dia(2026, 9, 11));

    const attemptId = await gerarPix("pix-1");
    registrarPendente("pix-1", attemptId);

    // Enquanto está pendente, nada é liberado. Este é o ponto: a tela não
    // decide, o provedor decide, e ele ainda não disse que entrou dinheiro.
    await reconciliarPagamento("pix-1");
    expect(ciclos()).toHaveLength(0);
    expect(tabelas.subscription).toHaveLength(0);

    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    const r = await reconciliarPagamento("pix-1");

    expect(r.mudou).toBe(true);
    expect(ciclos()).toHaveLength(1);

    const s = assinatura();
    expect(s.plan).toBe("MONTHLY");
    expect(s.status).toBe("ACTIVE");
    expect(s.billingMode).toBe("MANUAL_RENEW");
    expect(s.currentPeriodEnd).toEqual(dia(2026, 10, 11));
    // Nenhum contrato no provedor: ninguém vai cobrar nada sozinho.
    expect(s.externalPreapprovalId).toBeNull();
    // A carência nasce com o ciclo: acesso até 16/10.
    expect(s.graceUntil).toEqual(dia(2026, 10, 16));

    expect(carteira(dia(2026, 10, 1)).premium).toBe(true);
    // A tentativa fecha aprovada — é a cobrança daquele mês, não um contrato.
    expect(tabelas.paymentAttempt[0]!.status).toBe("APPROVED");
  });

  it("o pagamento registrado sabe que foi uma renovação manual", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const attemptId = await gerarPix("pix-1");
    registrarPendente("pix-1", attemptId);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    await reconciliarPagamento("pix-1");

    // Sem esta coluna, "quantas renovações Pix houve em setembro" só se
    // responderia por `method` — que amanhã pode aparecer noutro fluxo.
    expect(ciclos()[0]!.billingMode).toBe("MANUAL_RENEW");
    expect(ciclos()[0]!.kind).toBe("SUBSCRIPTION");
    expect(ciclos()[0]!.plan).toBe("MONTHLY");
  });
});

describe("renovação", () => {
  async function primeiroCiclo() {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    await reconciliarPagamento("pix-1");
  }

  it("renovar antes do vencimento não custa dias", async () => {
    await primeiroCiclo();

    // Vence 11/10; ela paga 08/10. O mês novo entra no fim do atual.
    vi.setSystemTime(dia(2026, 10, 8));
    const a = await gerarPix("pix-2");
    registrarPendente("pix-2", a);
    aprovarNoProvedor("pix-2", dia(2026, 10, 8));
    await reconciliarPagamento("pix-2");

    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 11, 11));
    expect(ciclos()).toHaveLength(2);
    expect(ciclos()[1]!.periodStart).toEqual(dia(2026, 10, 11));
  });

  it("renovar no último dia mantém a data de sempre", async () => {
    await primeiroCiclo();

    vi.setSystemTime(dia(2026, 10, 10, 22));
    const a = await gerarPix("pix-2");
    registrarPendente("pix-2", a);
    aprovarNoProvedor("pix-2", dia(2026, 10, 10, 22));
    await reconciliarPagamento("pix-2");

    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 11, 11));
  });

  it("renovar dentro da carência não dá dias de brinde", async () => {
    await primeiroCiclo();

    // Venceu 11/10, ela paga 14/10 → 11/10 → 11/11, e não 14/11. A carência é
    // prazo para pagar; transformá-la em dias grátis faria atrasar compensar.
    vi.setSystemTime(dia(2026, 10, 14));
    await marcarVencimentosManuais();
    expect(assinatura().status).toBe("PAST_DUE");
    // E durante a carência ela continua assistindo.
    expect(carteira(dia(2026, 10, 14)).premium).toBe(true);

    const a = await gerarPix("pix-2");
    registrarPendente("pix-2", a);
    aprovarNoProvedor("pix-2", dia(2026, 10, 14));
    await reconciliarPagamento("pix-2");

    const s = assinatura();
    expect(s.currentPeriodEnd).toEqual(dia(2026, 11, 11));
    expect(s.status).toBe("ACTIVE");
    expect(s.graceUntil).toEqual(dia(2026, 11, 16));
  });

  it("quem volta depois da carência começa um período novo", async () => {
    await primeiroCiclo();

    // Carência acabou 16/10 e o cron cortou.
    vi.setSystemTime(dia(2026, 10, 17));
    await marcarVencimentosManuais();
    await expirarAssinaturasVencidas(dia(2026, 10, 17));
    expect(assinatura().status).toBe("EXPIRED");
    expect(carteira(dia(2026, 10, 17)).premium).toBe(false);

    // Ela volta em 25/11.
    vi.setSystemTime(dia(2026, 11, 25));
    const a = await gerarPix("pix-2");
    registrarPendente("pix-2", a);
    aprovarNoProvedor("pix-2", dia(2026, 11, 25));
    await reconciliarPagamento("pix-2");

    const s = assinatura();
    expect(s.currentPeriodStart).toEqual(dia(2026, 11, 25));
    expect(s.currentPeriodEnd).toEqual(dia(2026, 12, 25));
    expect(carteira(dia(2026, 12, 1)).premium).toBe(true);
  });
});

describe("fim da carência", () => {
  it("corta o catálogo mas não toca no que ela comprou", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    await reconciliarPagamento("pix-1");

    // Uma novela comprada avulso, perpétua.
    await bancoFalso.entitlement.create({
      data: {
        userId: USUARIO,
        kind: "TITLE_PURCHASE",
        status: "ACTIVE",
        source: "PURCHASE",
        novelaId: "novela-1",
        startsAt: dia(2026, 9, 12),
        endsAt: null,
      },
    });

    // Dentro da carência: tudo de pé.
    expect(carteira(dia(2026, 10, 14)).premium).toBe(true);

    vi.setSystemTime(dia(2026, 10, 17));
    await marcarVencimentosManuais();
    await expirarAssinaturasVencidas(dia(2026, 10, 17));

    const depois = carteira(dia(2026, 10, 17));
    expect(depois.premium).toBe(false);
    // A garantia que não pode quebrar nunca.
    expect(depois.titulosComprados).toEqual(["novela-1"]);
  });
});

describe("idempotência", () => {
  async function pagoUmaVez() {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    await reconciliarPagamento("pix-1");
  }

  it("o mesmo paymentId, entregue cinco vezes, concede um mês só", async () => {
    await pagoUmaVez();

    for (let i = 0; i < 5; i += 1) await reconciliarPagamento("pix-1");

    expect(ciclos()).toHaveLength(1);
    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 10, 11));
    // E um único direito ativo: o índice parcial recusaria o segundo.
    expect(
      tabelas.entitlement.filter((e) => e.status === "ACTIVE" && e.novelaId == null),
    ).toHaveLength(1);
  });

  it("duas passagens concorrentes concedem um mês só", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));

    // Webhook e tela de espera ao mesmo tempo. As leituras cedem a vez, então
    // as duas passam pela checagem "já existe?" antes de qualquer escrita —
    // quem segura é a unicidade do banco, não um `if`.
    await Promise.all([
      reconciliarPagamento("pix-1"),
      reconciliarPagamento("pix-1"),
    ]);

    expect(ciclos()).toHaveLength(1);
    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 10, 11));
  });

  it("a corrida que escapa da checagem esbarra na unicidade do ciclo", async () => {
    await pagoUmaVez();

    // Um segundo Pix legítimo, e no exato instante de gravar o ciclo 2 outra
    // passagem já gravou. O `P2002` faz reler e decidir de novo — nunca somar
    // dois meses pela mesma cobrança.
    vi.setSystemTime(dia(2026, 9, 20));
    const a = await gerarPix("pix-2");
    registrarPendente("pix-2", a);
    aprovarNoProvedor("pix-2", dia(2026, 9, 20));

    let usado = false;
    antesDeCriarPagamento = (data) => {
      if (usado || data.cycleIndex !== 2) return;
      usado = true;
      // Alguém chegou primeiro com o ciclo 2.
      tabelas.payment.push({
        id: "intruso",
        subscriptionId: data.subscriptionId,
        cycleIndex: 2,
        provider: "mercadopago",
        externalId: "outro",
        status: "APPROVED",
        periodEnd: dia(2026, 10, 11),
      });
    };

    await reconciliarPagamento("pix-2");
    antesDeCriarPagamento = null;

    const meus = tabelas.payment.filter((p) => p.externalId === "pix-2");
    expect(meus).toHaveLength(1);
    expect(meus[0]!.cycleIndex).toBe(3);
  });
});

describe("dois Pix diferentes, os dois pagos", () => {
  it("cada cobrança real vira exatamente um mês, encadeados", async () => {
    vi.setSystemTime(dia(2026, 9, 11));

    const a1 = await gerarPix("pix-1");
    registrarPendente("pix-1", a1);

    // A primeira expirou na cabeça dela, então gerou outra — e acabou pagando
    // as duas. O dinheiro é real nas duas vezes; o benefício também.
    tabelas.paymentAttempt[0]!.expiresAt = dia(2026, 9, 11, 11);
    vi.setSystemTime(dia(2026, 9, 11, 13));
    const a2 = await gerarPix("pix-2");
    registrarPendente("pix-2", a2);
    expect(a2).not.toBe(a1);

    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    aprovarNoProvedor("pix-2", dia(2026, 9, 11, 13));
    await reconciliarPagamento("pix-1");
    await reconciliarPagamento("pix-2");

    expect(ciclos()).toHaveLength(2);
    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 11, 11));
    // E é auditável: dois pagamentos, dois ciclos, cada um com seu período.
    expect(ciclos().map((c) => c.cycleIndex)).toEqual([1, 2]);
  });

  it("dois toques no botão reaproveitam a mesma cobrança", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a1 = await gerarPix("pix-1");
    const a2 = await gerarPix("pix-2");

    // O segundo toque devolve o Pix que já existe: ninguém deve ficar com dois
    // QR abertos por ter tocado duas vezes.
    expect(a2).toBe(a1);
    expect(provedor.criados).toHaveLength(1);
  });
});

describe("Pix que não foi pago", () => {
  it("expirado fecha a tentativa e não concede nada", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    provedor.pagamentos["pix-1"] = pagamento("pix-1", a, "CANCELED", null);

    const r = await reconciliarPagamento("pix-1");

    expect(r.mudou).toBe(true);
    expect(ciclos()).toHaveLength(0);
    expect(tabelas.subscription).toHaveLength(0);
    expect(tabelas.paymentAttempt[0]!.status).toBe("EXPIRED");
  });

  it("gerar outro depois do expirado preserva o histórico do anterior", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a1 = await gerarPix("pix-1");
    provedor.pagamentos["pix-1"] = pagamento("pix-1", a1, "CANCELED", null);
    await reconciliarPagamento("pix-1");

    const a2 = await gerarPix("pix-2");

    expect(a2).not.toBe(a1);
    expect(tabelas.paymentAttempt).toHaveLength(2);
    // A tentativa antiga continua lá, com o desfecho dela: é assim que se
    // descobre depois quantos QR nunca viraram pagamento.
    expect(tabelas.paymentAttempt[0]!.status).toBe("EXPIRED");
  });
});

describe("webhook que não chegou", () => {
  it("a varredura descobre sozinha o Pix pago com o app fechado", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);

    // Ela pagou no banco e fechou tudo. Nenhum webhook chegou, ninguém abriu
    // a tela. O acesso não pode depender disso.
    aprovarNoProvedor("pix-1", dia(2026, 9, 11, 13));

    vi.setSystemTime(dia(2026, 9, 11, 20));
    const resumo = await reconciliarPixPendentes();

    expect(resumo.ciclosNovos).toBe(1);
    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 10, 11, 13));
    expect(carteira(dia(2026, 9, 12)).premium).toBe(true);
  });

  it("o Pix pago na virada do prazo é recuperado mesmo já marcado expirado", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);

    // A tela marcou expirada; do lado deles, a aprovação veio logo depois.
    provedor.pagamentos["pix-1"] = pagamento("pix-1", a, "CANCELED", null);
    await reconciliarPagamento("pix-1");
    expect(tabelas.paymentAttempt[0]!.status).toBe("EXPIRED");

    provedor.pagamentos["pix-1"] = pagamento(
      "pix-1",
      a,
      "APPROVED",
      dia(2026, 9, 11, 12),
    );

    vi.setSystemTime(dia(2026, 9, 11, 14));
    const resumo = await reconciliarPixPendentes();

    expect(resumo.ciclosNovos).toBe(1);
    expect(assinatura().currentPeriodEnd).toEqual(dia(2026, 10, 11));
  });

  it("a varredura roda duas vezes sem conceder dois meses", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));

    await reconciliarPixPendentes();
    await reconciliarPixPendentes();

    expect(ciclos()).toHaveLength(1);
  });
});

describe("convivência com o cartão", () => {
  it("recusa abrir Pix para quem já tem cartão renovando sozinho", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    await bancoFalso.subscription.create({
      data: {
        userId: USUARIO,
        plan: "MONTHLY",
        status: "ACTIVE",
        billingMode: "AUTO_RENEW",
        externalPreapprovalId: "pre-1",
        currentPeriodEnd: dia(2026, 10, 11),
      },
    });

    // Deixar passar significaria ela pagando o Pix enquanto o Mercado Pago
    // segue cobrando o cartão no fim do mês.
    await expect(
      iniciarAssinaturaPix({ userId: USUARIO, plano: "MONTHLY" }),
    ).rejects.toMatchObject({ codigo: "renovacao-automatica-ativa" });
    expect(provedor.criados).toHaveLength(0);
  });

  it("permite Pix a quem cancelou a renovação automática", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    await bancoFalso.subscription.create({
      data: {
        userId: USUARIO,
        plan: "MONTHLY",
        status: "ACTIVE",
        billingMode: "AUTO_RENEW",
        externalPreapprovalId: "pre-1",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: dia(2026, 10, 11),
      },
    });

    const attemptId = await gerarPix("pix-1");
    registrarPendente("pix-1", attemptId);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    await reconciliarPagamento("pix-1");

    const s = assinatura();
    // O mês pago no cartão não se perde: o Pix encadeia no fim dele.
    expect(s.currentPeriodEnd).toEqual(dia(2026, 11, 11));
    expect(s.billingMode).toBe("MANUAL_RENEW");
    // E o contrato antigo sai do caminho, senão a varredura diária o
    // consultaria para sempre.
    expect(s.externalPreapprovalId).toBeNull();
    expect(s.cancelAtPeriodEnd).toBe(false);
  });

  it("não há o que cancelar num plano que não cobra sozinho", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    const a = await gerarPix("pix-1");
    registrarPendente("pix-1", a);
    aprovarNoProvedor("pix-1", dia(2026, 9, 11));
    await reconciliarPagamento("pix-1");

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toMatchObject({
      codigo: "renovacao-manual",
    });
    // E nada foi gravado: um `cancelAtPeriodEnd` aqui seria um fato falso.
    expect(assinatura().cancelAtPeriodEnd).toBe(false);
  });

  it("só o mensal aceita Pix", async () => {
    vi.setSystemTime(dia(2026, 9, 11));

    await expect(
      iniciarAssinaturaPix({ userId: USUARIO, plano: "ANNUAL" }),
    ).rejects.toMatchObject({ codigo: "plano-invalido" });
    expect(provedor.criados).toHaveLength(0);
  });
});

describe("validade do QR enviada ao provedor", () => {
  it("vai com deslocamento explícito, e não com Z", async () => {
    // O Mercado Pago responde 400 a `date_of_expiration` terminando em `Z`.
    // Errar isto é silencioso até a primeira cobrança real: o checkout falha
    // inteiro, e a mensagem deles não diz qual campo.
    const { comFuso } = await import("./mercadopago");
    const quando = new Date("2026-09-11T23:59:07.123Z");
    const texto = comFuso(quando);

    expect(texto).not.toMatch(/Z$/);
    expect(texto).toMatch(/[+-]\d{2}:\d{2}$/);
    // E continua sendo o mesmo instante: um fuso mal montado adiantaria ou
    // atrasaria a expiração em horas.
    expect(new Date(texto).getTime()).toBe(quando.getTime());
  });

  it("o QR pedido dura a meia hora combinada", async () => {
    vi.setSystemTime(dia(2026, 9, 11));
    await gerarPix("pix-1");

    expect(provedor.criados[0]!.expiraEmMinutos).toBe(30);
  });
});
