/**
 * Cancelar só depois que o provedor confirmar.
 *
 * O risco que estes testes existem para impedir: `cancelarAssinaturaDoUsuario`
 * chamava `PUT /preapproval` dentro de um `catch {}` vazio e gravava
 * "cancelada" no nosso banco de qualquer jeito. Se a chamada falhasse, o
 * Noveleiras dizia uma coisa e o Mercado Pago seguia com a assinatura viva,
 * cobrando no ciclo seguinte. E como **nada reconsulta assinatura
 * periodicamente**, a divergência só apareceria na próxima fatura.
 *
 * A regra agora é uma só: sem confirmação do provedor, o banco não muda.
 *
 * O duplo de banco sabe errar de propósito — ele grava de verdade. Se a
 * função voltasse a marcar cancelamento sem confirmação, os cenários de falha
 * veriam `cancelAtPeriodEnd: true` e derrubariam o teste.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsultaAssinatura, EstadoProvedor } from "./provedor";

// ------------------------------------------------------------ banco falso

type Linha = Record<string, unknown>;

const tabelas = {
  subscription: [] as Linha[],
  subscriptionEvent: [] as Linha[],
  entitlement: [] as Linha[],
};

function casa(linha: Linha, where: Linha | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, valor]) => {
    if (valor === null) return linha[campo] == null;
    return linha[campo] === valor;
  });
}

let sequencia = 0;

function tabela(nome: keyof typeof tabelas) {
  const linhas = () => tabelas[nome];
  return {
    findUnique: async ({ where }: { where: Linha }) =>
      linhas().find((l) => casa(l, where)) ?? null,
    findFirst: async ({ where }: { where?: Linha } = {}) =>
      linhas().find((l) => casa(l, where)) ?? null,
    findMany: async ({ where }: { where?: Linha } = {}) =>
      linhas().filter((l) => casa(l, where)),
    create: async ({ data }: { data: Linha }) => {
      const linha = { id: `${nome}-${++sequencia}`, ...data };
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
  subscription: tabela("subscription"),
  subscriptionEvent: tabela("subscriptionEvent"),
  entitlement: tabela("entitlement"),
  $transaction: async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => Promise<unknown>)(bancoFalso)
      : await Promise.all(arg as Promise<unknown>[]),
};

vi.mock("@/lib/db", () => ({ db: bancoFalso }));

/** O log grava no banco; aqui só interessa **que** a falha foi registrada. */
const registrados: Array<{ nivel: string; message: string; context?: unknown }> =
  [];

vi.mock("@/lib/painel/log", () => ({
  log: {
    info: (e: { message: string; context?: unknown }) =>
      registrados.push({ nivel: "INFO", ...e }),
    warn: (e: { message: string; context?: unknown }) =>
      registrados.push({ nivel: "WARN", ...e }),
    error: (e: { message: string; context?: unknown }) =>
      registrados.push({ nivel: "ERROR", ...e }),
  },
}));

// -------------------------------------------------------- provedor falso

const PREAPPROVAL = "28fe6481160b4e439bb6f42993dffb4f";
const USUARIO = "user-anual";
const NOVELA_COMPRADA = "novela-comprada";

/** Como o provedor se comporta neste teste. */
let aoCancelar: () => Promise<EstadoProvedor> = async () => "CANCELED";
let aoConsultar: () => Promise<ConsultaAssinatura | null> = async () => null;
const chamadas = { cancelar: 0, consultar: 0 };

vi.mock("./index", () => ({
  podeUsarMock: () => false,
  provedorDePagamento: () => ({
    nome: "mercadopago",
    cancelarAssinatura: async () => {
      chamadas.cancelar += 1;
      return aoCancelar();
    },
    consultarAssinatura: async () => {
      chamadas.consultar += 1;
      return aoConsultar();
    },
  }),
}));

const { cancelarAssinaturaDoUsuario, ErroDeCobranca } = await import(
  "./servico"
);

// ------------------------------------------------------------- cenários

const FIM_DO_CICLO = new Date("2027-09-10T23:26:10.029Z");

function assinatura(): Linha {
  return tabelas.subscription[0]!;
}

function direitoDaAssinatura(): Linha {
  return tabelas.entitlement.find((e) => e.kind === "SUBSCRIPTION_ANNUAL")!;
}

function direitoDeCompra(): Linha {
  return tabelas.entitlement.find((e) => e.kind === "TITLE_PURCHASE")!;
}

function consultaComStatus(status: EstadoProvedor): ConsultaAssinatura {
  return {
    externalId: PREAPPROVAL,
    status,
    referenciaExterna: null,
    proximaCobranca: null,
    bruto: {},
  };
}

beforeEach(() => {
  tabelas.subscription = [
    {
      id: "sub-anual",
      userId: USUARIO,
      plan: "ANNUAL",
      status: "ACTIVE",
      provider: "mercadopago",
      priceCents: 9990,
      externalId: PREAPPROVAL,
      externalPreapprovalId: PREAPPROVAL,
      currentPeriodStart: new Date("2026-09-10T23:26:10.029Z"),
      currentPeriodEnd: FIM_DO_CICLO,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
  ];
  tabelas.subscriptionEvent = [];
  tabelas.entitlement = [
    {
      id: "direito-anual",
      userId: USUARIO,
      kind: "SUBSCRIPTION_ANNUAL",
      status: "ACTIVE",
      novelaId: null,
      subscriptionId: "sub-anual",
      endsAt: FIM_DO_CICLO,
      revokedAt: null,
    },
    {
      id: "direito-compra",
      userId: USUARIO,
      kind: "TITLE_PURCHASE",
      status: "ACTIVE",
      novelaId: NOVELA_COMPRADA,
      subscriptionId: null,
      purchaseId: "compra-1",
      endsAt: null,
      revokedAt: null,
    },
  ];

  aoCancelar = async () => "CANCELED";
  aoConsultar = async () => null;
  chamadas.cancelar = 0;
  chamadas.consultar = 0;
  registrados.length = 0;
});

/** O que nunca pode mudar num cancelamento, dê no que der. */
function esperarAcessoPreservado() {
  expect(assinatura().status).toBe("ACTIVE");
  expect(assinatura().currentPeriodEnd).toEqual(FIM_DO_CICLO);
  // O direito da assinatura só expira no fim do ciclo, e por data.
  expect(direitoDaAssinatura().status).toBe("ACTIVE");
  expect(direitoDaAssinatura().revokedAt).toBeNull();
  expect(direitoDaAssinatura().endsAt).toEqual(FIM_DO_CICLO);
  // A novela comprada é de outra natureza e não entra nesta conversa.
  expect(direitoDeCompra().status).toBe("ACTIVE");
  expect(direitoDeCompra().endsAt).toBeNull();
  expect(direitoDeCompra().revokedAt).toBeNull();
}

describe("Mercado Pago confirma o cancelamento", () => {
  it("grava cancelAtPeriodEnd e preserva o acesso até o fim do ciclo", async () => {
    const { ativoAte } = await cancelarAssinaturaDoUsuario(USUARIO);

    expect(ativoAte).toEqual(FIM_DO_CICLO);
    expect(assinatura().cancelAtPeriodEnd).toBe(true);
    expect(assinatura().canceledAt).toBeInstanceOf(Date);
    esperarAcessoPreservado();
  });

  it("registra a confirmação, o status e o preapproval no evento", async () => {
    await cancelarAssinaturaDoUsuario(USUARIO);

    expect(tabelas.subscriptionEvent).toHaveLength(1);
    const evento = tabelas.subscriptionEvent[0]!;
    expect(evento.type).toBe("CANCEL_REQUESTED");
    expect(evento.periodEnd).toEqual(FIM_DO_CICLO);
    expect(evento.payload).toEqual({
      confirmadoPeloProvedor: true,
      providerStatus: "CANCELED",
      externalPreapprovalId: PREAPPROVAL,
    });
  });

  it("não reconsulta quando o PUT já respondeu cancelado", async () => {
    await cancelarAssinaturaDoUsuario(USUARIO);
    expect(chamadas.cancelar).toBe(1);
    expect(chamadas.consultar).toBe(0);
  });
});

describe("Mercado Pago falha", () => {
  it("erro na chamada não produz cancelamento local falso", async () => {
    aoCancelar = async () => {
      throw new Error("Mercado Pago respondeu 500 em /preapproval");
    };

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow(
      ErroDeCobranca,
    );

    expect(assinatura().cancelAtPeriodEnd).toBe(false);
    expect(assinatura().canceledAt).toBeNull();
    expect(tabelas.subscriptionEvent).toHaveLength(0);
    esperarAcessoPreservado();
  });

  it("timeout também preserva tudo", async () => {
    aoCancelar = async () => {
      throw new Error("The operation was aborted due to timeout");
    };
    aoConsultar = async () => {
      throw new Error("The operation was aborted due to timeout");
    };

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow(
      ErroDeCobranca,
    );

    expect(assinatura().cancelAtPeriodEnd).toBe(false);
    expect(tabelas.subscriptionEvent).toHaveLength(0);
    esperarAcessoPreservado();
  });

  it("status inesperado não conta como cancelado", async () => {
    // O provedor respondeu, mas com outra coisa — `paused`, por exemplo.
    aoCancelar = async () => "PENDING";
    aoConsultar = async () => consultaComStatus("PENDING");

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow(
      ErroDeCobranca,
    );

    expect(assinatura().cancelAtPeriodEnd).toBe(false);
    esperarAcessoPreservado();
  });

  it("a falha vai para a auditoria, com erro sanitizado", async () => {
    aoCancelar = async () => {
      throw new Error("Mercado Pago respondeu 400 em /preapproval");
    };

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow();

    const erro = registrados.find((r) => r.nivel === "ERROR");
    expect(erro).toBeDefined();
    const contexto = erro!.context as Record<string, unknown>;
    expect(contexto.externalPreapprovalId).toBe(PREAPPROVAL);
    expect(contexto.subscriptionId).toBe("sub-anual");
    // Campos escolhidos, nunca o corpo cru do provedor.
    const provedor = contexto.provedor as Record<string, unknown>;
    expect(typeof provedor.message).toBe("string");
    expect(provedor).toHaveProperty("httpStatus");
    expect(provedor).toHaveProperty("requestId");
  });

  it("a mensagem devolvida diz que nada mudou e convida a tentar de novo", async () => {
    aoCancelar = async () => {
      throw new Error("falha de rede");
    };

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toMatchObject({
      codigo: "cancelamento-nao-confirmado",
    });
  });

  it("depois de falhar, uma nova tentativa funciona", async () => {
    aoCancelar = async () => {
      throw new Error("instabilidade momentânea");
    };
    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow();
    expect(assinatura().cancelAtPeriodEnd).toBe(false);

    // O provedor volta ao normal.
    aoCancelar = async () => "CANCELED";
    const { ativoAte } = await cancelarAssinaturaDoUsuario(USUARIO);

    expect(ativoAte).toEqual(FIM_DO_CICLO);
    expect(assinatura().cancelAtPeriodEnd).toBe(true);
    expect(tabelas.subscriptionEvent).toHaveLength(1);
  });
});

describe("assinatura já cancelada no provedor", () => {
  it("o 400 do PUT é resolvido pela reconsulta, e o cancelamento vale", async () => {
    // É o que o Mercado Pago faz quando já está cancelada.
    aoCancelar = async () => {
      throw new Error("Mercado Pago respondeu 400 em /preapproval");
    };
    aoConsultar = async () => consultaComStatus("CANCELED");

    const { ativoAte } = await cancelarAssinaturaDoUsuario(USUARIO);

    expect(ativoAte).toEqual(FIM_DO_CICLO);
    expect(assinatura().cancelAtPeriodEnd).toBe(true);
    expect(chamadas.consultar).toBe(1);
    esperarAcessoPreservado();
  });

  it("pedir cancelamento duas vezes não duplica evento nem muda o ciclo", async () => {
    await cancelarAssinaturaDoUsuario(USUARIO);
    const primeiroCanceladoEm = assinatura().canceledAt;

    await cancelarAssinaturaDoUsuario(USUARIO);

    expect(assinatura().cancelAtPeriodEnd).toBe(true);
    expect(assinatura().currentPeriodEnd).toEqual(FIM_DO_CICLO);
    expect(assinatura().status).toBe("ACTIVE");
    // O segundo pedido é registrado — é auditoria, não idempotência de dado —
    // mas nada do estado da assinatura muda além do carimbo de hora.
    expect(tabelas.subscriptionEvent).toHaveLength(2);
    expect(assinatura().canceledAt).not.toBe(primeiroCanceladoEm);
    esperarAcessoPreservado();
  });
});

describe("o que o cancelamento nunca toca", () => {
  it("TITLE_PURCHASE fica completamente isolado, no sucesso e na falha", async () => {
    await cancelarAssinaturaDoUsuario(USUARIO);
    expect(direitoDeCompra()).toMatchObject({
      status: "ACTIVE",
      endsAt: null,
      revokedAt: null,
      novelaId: NOVELA_COMPRADA,
      subscriptionId: null,
    });

    aoCancelar = async () => {
      throw new Error("falha");
    };
    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow();
    expect(direitoDeCompra()).toMatchObject({
      status: "ACTIVE",
      endsAt: null,
      revokedAt: null,
    });
  });

  it("sem assinatura paga não há o que cancelar", async () => {
    tabelas.subscription = [
      { id: "sub-free", userId: USUARIO, plan: "FREE", status: "ACTIVE" },
    ];

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toMatchObject({
      codigo: "sem-assinatura",
    });
    // Não chegou a incomodar o provedor.
    expect(chamadas.cancelar).toBe(0);
  });
});

// ------------------------------------------- a grafia que vai para a API

/**
 * O valor enviado no `PUT /preapproval/{id}`.
 *
 * A documentação do Mercado Pago diverge de si mesma — a página de
 * cancelamento e o `/preapproval/export` dizem `canceled`, com um L; as de
 * ciclo de vida dizem `cancelled`. Quem desempatou foi a API em produção:
 *
 *     {"status":"canceled"} → 400 "Invalid preapproval status param: canceled"
 *
 * Este teste existe porque errar a string é invisível: o 400 não aponta o
 * campo culpado, e nenhum outro teste pegaria a regressão. Quem for
 * "corrigir" a grafia pela documentação esbarra aqui primeiro.
 */
describe("o corpo enviado ao Mercado Pago", () => {
  it("manda status cancelled, com dois L, e le as duas grafias de volta", async () => {
    const { MercadoPago } = await import("./mercadopago");

    const originais = { ...process.env };
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "segredo";

    const enviados: Array<{ url: string; metodo?: string; corpo: unknown }> = [];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      enviados.push({
        url: String(url),
        metodo: init?.method,
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      });
      // Responde com a grafia de UM L, que a documentacao usa: a leitura tem
      // de reconhece-la mesmo assim.
      return new Response(JSON.stringify({ status: "canceled" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const estado = await new MercadoPago().cancelarAssinatura("pre-1");

      expect(enviados).toHaveLength(1);
      expect(enviados[0]!.metodo).toBe("PUT");
      expect(enviados[0]!.url).toContain("/preapproval/pre-1");
      expect(enviados[0]!.corpo).toEqual({ status: "cancelled" });
      expect(estado).toBe("CANCELED");
    } finally {
      globalThis.fetch = fetchOriginal;
      process.env = originais;
    }
  });
});

// ------------------------------------------------- diagnostico sanitizado

/**
 * O que vai para a auditoria quando o provedor recusa.
 *
 * A primeira tentativa real de cancelamento gravou apenas "respondeu 400" e a
 * investigação parou aí: sem `message`, sem `cause`, sem request id, um 400 é
 * indiagnosticável. Estes testes fixam o que passa e, principalmente, o que
 * **não** passa — token, cabeçalho de autorização e dado de cartão não podem
 * cair numa tabela que meio time lê.
 */
describe("sanitizarFalha", () => {
  it("extrai os campos que o Mercado Pago manda num 400", async () => {
    const { FalhaDoProvedor, sanitizarFalha } = await import("./provedor");

    const falha = new FalhaDoProvedor(
      "Mercado Pago respondeu 400 em /preapproval/abc",
      400,
      {
        message: "Invalid preapproval status",
        error: "bad_request",
        status: 400,
        cause: [{ code: 2034, description: "status attribute is invalid" }],
      },
      "req-9f2c",
    );

    expect(sanitizarFalha(falha)).toEqual({
      httpStatus: 400,
      message: "Invalid preapproval status",
      error: "bad_request",
      code: null,
      status: 400,
      cause: [{ code: 2034, description: "status attribute is invalid" }],
      requestId: "req-9f2c",
    });
  });

  it("nao carrega token, authorization nem dado de cartao", async () => {
    const { FalhaDoProvedor, sanitizarFalha } = await import("./provedor");

    const falha = new FalhaDoProvedor("respondeu 400", 400, {
      message: "recusado",
      // Tudo isto existe em respostas reais e nao pode vazar.
      access_token: "APP_USR-3530880950-secreto",
      headers: { authorization: "Bearer APP_USR-3530880950-secreto" },
      card: { last_four_digits: "4321", token: "tok_abc" },
      payer: { email: "pagador@exemplo.com", identification: "123.456.789-00" },
    });

    const limpo = JSON.stringify(sanitizarFalha(falha));

    for (const proibido of [
      "APP_USR",
      "Bearer",
      "authorization",
      "4321",
      "tok_abc",
      "pagador@exemplo.com",
      "123.456.789-00",
    ]) {
      expect(limpo).not.toContain(proibido);
    }
    expect(sanitizarFalha(falha).message).toBe("recusado");
  });

  it("um timeout vira mensagem, sem inventar campos do provedor", async () => {
    const { sanitizarFalha } = await import("./provedor");

    const limpo = sanitizarFalha(
      new Error("The operation was aborted due to timeout"),
    );

    expect(limpo.httpStatus).toBeNull();
    expect(limpo.requestId).toBeNull();
    expect(limpo.cause).toEqual([]);
    expect(limpo.message).toContain("timeout");
  });

  it("trunca texto longo e limita a lista de causas", async () => {
    const { FalhaDoProvedor, sanitizarFalha } = await import("./provedor");

    const limpo = sanitizarFalha(
      new FalhaDoProvedor("x", 400, {
        message: "a".repeat(5000),
        cause: Array.from({ length: 40 }, (_, i) => ({
          code: i,
          description: "b".repeat(5000),
        })),
      }),
    );

    expect(limpo.message!.length).toBeLessThanOrEqual(300);
    expect(limpo.cause).toHaveLength(5);
    expect(limpo.cause[0]!.description!.length).toBeLessThanOrEqual(300);
  });
});

describe("o log da falha de cancelamento", () => {
  it("carrega o diagnostico do provedor e o status que foi enviado", async () => {
    const { FalhaDoProvedor } = await import("./provedor");

    aoCancelar = async () => {
      throw new FalhaDoProvedor(
        "Mercado Pago respondeu 400 em /preapproval/abc",
        400,
        {
          message: "Invalid preapproval status",
          error: "bad_request",
          cause: [{ code: 2034, description: "status attribute is invalid" }],
        },
        "req-9f2c",
      );
    };

    await expect(cancelarAssinaturaDoUsuario(USUARIO)).rejects.toThrow();

    const erro = registrados.find((r) => r.nivel === "ERROR")!;
    const contexto = erro.context as Record<string, unknown>;
    const provedor = contexto.provedor as Record<string, unknown>;

    expect(contexto.statusEnviado).toBe("canceled");
    expect(provedor.httpStatus).toBe(400);
    expect(provedor.message).toBe("Invalid preapproval status");
    expect(provedor.error).toBe("bad_request");
    expect(provedor.requestId).toBe("req-9f2c");
    expect(provedor.cause).toEqual([
      { code: 2034, description: "status attribute is invalid" },
    ]);

    // E o essencial segue valendo: nada mudou no banco.
    expect(assinatura().cancelAtPeriodEnd).toBe(false);
    esperarAcessoPreservado();
  });
});
