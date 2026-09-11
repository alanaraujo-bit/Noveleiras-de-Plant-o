/**
 * O receptor de webhooks: Webhook assinado x IPN legado, e a idempotência
 * que não transforma tentativa recusada em sucesso definitivo.
 *
 * Os casos reais que motivaram isto estão em produção (`WebhookEvent`,
 * 10/09): IPN `{topic, resource}` gravado como "assinatura inválida", e
 * tentativas recusadas ocupando o `eventId` real — o que faria a reentrega
 * válida do mesmo evento ser respondida como duplicada e nunca processada.
 *
 * O duplo de banco aplica a unicidade `(provider, eventId)` de verdade,
 * respondendo P2002 como o Prisma. Sem isso, os testes de reentrega não
 * provariam nada.
 */
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------ banco falso

type Linha = Record<string, unknown> & {
  id: string;
  provider: string;
  eventId: string;
  status: string;
  signatureValid: boolean;
  updatedAt: Date;
};

const eventos: Linha[] = [];
let sequencia = 0;

function casa(linha: Linha, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([campo, valor]) =>
    valor instanceof Date
      ? (linha[campo] as Date | undefined)?.getTime() === valor.getTime()
      : linha[campo] === valor,
  );
}

function aplicar(linha: Linha, data: Record<string, unknown>) {
  for (const [campo, valor] of Object.entries(data)) {
    if (valor && typeof valor === "object" && "increment" in valor) {
      linha[campo] =
        ((linha[campo] as number) ?? 0) + (valor as { increment: number }).increment;
    } else if (valor !== undefined) {
      linha[campo] = valor;
    }
  }
  // `@updatedAt`: sempre avança, mesmo dentro do mesmo milissegundo.
  linha.updatedAt = new Date(
    Math.max(Date.now(), linha.updatedAt.getTime() + 1),
  );
}

function ocupado(provider: string, eventId: string, exceto?: string) {
  return eventos.some(
    (e) => e.provider === provider && e.eventId === eventId && e.id !== exceto,
  );
}

function erroDeUnicidade() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

const bancoFalso = {
  webhookEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const provider = data.provider as string;
      const eventId = data.eventId as string;
      if (ocupado(provider, eventId)) throw erroDeUnicidade();
      const linha = {
        attempts: 0,
        error: null,
        ...data,
        id: `evt-${++sequencia}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Linha;
      eventos.push(linha);
      return { ...linha };
    },
    findUnique: async ({
      where,
    }: {
      where: { provider_eventId: { provider: string; eventId: string } };
    }) => {
      const { provider, eventId } = where.provider_eventId;
      const linha = eventos.find(
        (e) => e.provider === provider && e.eventId === eventId,
      );
      return linha ? { ...linha } : null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const linha = eventos.find((e) => e.id === where.id);
      if (!linha) throw new Error("webhookEvent: linha inexistente");
      aplicar(linha, data);
      return { ...linha };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const alvos = eventos.filter((e) => casa(e, where));
      for (const linha of alvos) {
        if (
          typeof data.eventId === "string" &&
          ocupado(linha.provider, data.eventId, linha.id)
        ) {
          throw erroDeUnicidade();
        }
        aplicar(linha, data);
      }
      return { count: alvos.length };
    },
  },
};

vi.mock("@/lib/db", () => ({ db: bancoFalso }));

// -------------------------------------------------- reconciliação falsa

/**
 * Cada chamada aqui é um efeito comercial em potencial — Payment,
 * Subscription, Entitlement, Purchase. Contar as chamadas é o que prova que
 * IPN e tentativa recusada não chegam a elas.
 */
const comercial = {
  pagamento: [] as string[],
  pedido: [] as string[],
  fatura: [] as string[],
  assinatura: [] as string[],
  falharPagamento: 0,
};

vi.mock("./servico", () => ({
  reconciliarPagamento: async (id: string) => {
    comercial.pagamento.push(id);
    if (comercial.falharPagamento > 0) {
      comercial.falharPagamento -= 1;
      throw new Error("Mercado Pago respondeu 500");
    }
    return { attemptId: "att-1", mudou: true };
  },
  reconciliarMerchantOrder: async (id: string) => {
    comercial.pedido.push(id);
    return { attemptId: "att-1", mudou: true };
  },
  reconciliarFatura: async (id: string) => {
    comercial.fatura.push(id);
    return { attemptId: "att-1", mudou: true };
  },
  reconciliarCicloDeAssinatura: async (id: string) => {
    comercial.assinatura.push(id);
    return { attemptId: "att-1", mudou: true };
  },
}));

const { receberWebhook, RECEBIDO_ORFAO_MS } = await import("./webhook");
const { ProvedorMock, SEGREDO_MOCK } = await import("./mock");
const { lerNotificacao } = await import("./notificacao");
const { comoWebhook, MercadoPago } = await import("./mercadopago");

const provedor = new ProvedorMock();

function efeitosComerciais() {
  return (
    comercial.pagamento.length +
    comercial.pedido.length +
    comercial.fatura.length +
    comercial.assinatura.length
  );
}

beforeEach(() => {
  eventos.length = 0;
  comercial.pagamento.length = 0;
  comercial.pedido.length = 0;
  comercial.fatura.length = 0;
  comercial.assinatura.length = 0;
  comercial.falharPagamento = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------- entregas

const PAGAMENTO = "178386070986";

/** Um Webhook no formato real de 10/09, assinado como o Mercado Pago assina. */
function webhook(
  opcoes: {
    eventId?: string;
    dataId?: string;
    segredo?: string;
    requestId?: string;
    semCabecalhos?: boolean;
    type?: string;
  } = {},
) {
  const dataId = opcoes.dataId ?? PAGAMENTO;
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = opcoes.requestId ?? "40b129c6-ce73-40f1-af44-bed81e05eb5b";
  const v1 = createHmac("sha256", opcoes.segredo ?? SEGREDO_MOCK)
    .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest("hex");

  return {
    v1,
    entregar: () =>
      receberWebhook(
        provedor,
        JSON.stringify({
          id: opcoes.eventId ?? "137484971656",
          type: opcoes.type ?? "payment",
          action: "payment.created",
          live_mode: true,
          api_version: "v1",
          date_created: "2026-09-10T23:16:39Z",
          user_id: 1,
          data: { id: dataId },
        }),
        opcoes.semCabecalhos
          ? new Headers()
          : new Headers({
              "x-signature": `ts=${ts},v1=${v1}`,
              "x-request-id": requestId,
            }),
        new URL(
          `https://noveleiras-de-plantao.vercel.app/api/pagamentos/webhook?data.id=${dataId}&type=${opcoes.type ?? "payment"}&source_news=webhooks`,
        ),
      ),
  };
}

function ipn(corpo: Record<string, unknown> | null, query = "") {
  return receberWebhook(
    provedor,
    corpo ? JSON.stringify(corpo) : "",
    new Headers(),
    new URL(`https://noveleiras-de-plantao.vercel.app/api/pagamentos/webhook${query}`),
  );
}

// ----------------------------------------------------------------- testes

describe("Webhook válido", () => {
  it("é processado uma vez e fica PROCESSED", async () => {
    const r = await webhook().entregar();

    expect(r.status).toBe(200);
    expect(comercial.pagamento).toEqual([PAGAMENTO]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      eventId: "137484971656",
      signatureValid: true,
      format: "WEBHOOK",
      status: "PROCESSED",
      resourceId: PAGAMENTO,
    });
  });

  it("repetido continua idempotente: 200 e nenhum segundo efeito", async () => {
    const w = webhook();
    await w.entregar();
    const repetido = await w.entregar();

    expect(repetido.status).toBe(200);
    expect(repetido.corpo).toMatchObject({ duplicado: true });
    expect(comercial.pagamento).toHaveLength(1);
    expect(eventos).toHaveLength(1);
  });

  it("encaminha cada tópico para a reconciliação certa", async () => {
    await webhook({ eventId: "e-mo", type: "merchant_order", dataId: "44343262753" }).entregar();
    await webhook({ eventId: "e-fat", type: "subscription_authorized_payment", dataId: "fat-1" }).entregar();
    await webhook({ eventId: "e-pre", type: "subscription_preapproval", dataId: "pre-1" }).entregar();

    expect(comercial.pedido).toEqual(["44343262753"]);
    expect(comercial.fatura).toEqual(["fat-1"]);
    expect(comercial.assinatura).toEqual(["pre-1"]);
  });
});

describe("Webhook inválido", () => {
  it("assinatura de outro segredo: 401, gravado, nada comercial", async () => {
    const r = await webhook({ segredo: "segredo-errado" }).entregar();

    expect(r.status).toBe(401);
    expect(efeitosComerciais()).toBe(0);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      signatureValid: false,
      status: "FAILED",
      format: "WEBHOOK",
      claimedEventId: "137484971656",
    });
    // Fora da chave de idempotência: o id real fica livre.
    expect(eventos[0].eventId).toMatch(/^rejeitado:/);
  });

  it("sem x-signature nem x-request-id: 401", async () => {
    const r = await webhook({ semCabecalhos: true }).entregar();

    expect(r.status).toBe(401);
    expect(efeitosComerciais()).toBe(0);
    expect(eventos[0].diagnostics).toMatchObject({
      hasXSignature: false,
      hasXRequestId: false,
      signatureHasTs: false,
      signatureHasV1: false,
    });
  });

  it("cada tentativa recusada é uma linha própria, auditável", async () => {
    await webhook({ segredo: "a" }).entregar();
    await webhook({ segredo: "b" }).entregar();

    expect(eventos).toHaveLength(2);
    expect(eventos.every((e) => e.claimedEventId === "137484971656")).toBe(true);
    expect(new Set(eventos.map((e) => e.eventId)).size).toBe(2);
  });
});

describe("reentrega válida depois de assinatura inválida", () => {
  it("é processada, e a tentativa recusada continua registrada", async () => {
    const recusada = await webhook({ segredo: "segredo-errado" }).entregar();
    const valida = await webhook().entregar();

    expect(recusada.status).toBe(401);
    expect(valida.status).toBe(200);
    expect(valida.corpo).not.toHaveProperty("duplicado");
    expect(comercial.pagamento).toEqual([PAGAMENTO]);

    expect(eventos).toHaveLength(2);
    expect(eventos.find((e) => e.signatureValid)).toMatchObject({
      eventId: "137484971656",
      status: "PROCESSED",
    });
    expect(eventos.find((e) => !e.signatureValid)).toMatchObject({
      status: "FAILED",
      claimedEventId: "137484971656",
    });
  });

  it("linha recusada gravada antes desta separação não bloqueia", async () => {
    // Forma exata das 6 linhas de produção: recusada ocupando o id real.
    eventos.push({
      id: "legado-1",
      provider: "mock",
      eventId: "137484971656",
      status: "FAILED",
      signatureValid: false,
      error: "assinatura invalida",
      updatedAt: new Date(),
    });

    const r = await webhook().entregar();

    expect(r.status).toBe(200);
    expect(comercial.pagamento).toEqual([PAGAMENTO]);
    expect(eventos.find((e) => e.id === "legado-1")).toMatchObject({
      eventId: "rejeitado:legado-1",
      claimedEventId: "137484971656",
      signatureValid: false,
    });
  });

  it("tentativa recusada nunca é considerada processada", async () => {
    await webhook({ segredo: "segredo-errado" }).entregar();
    expect(eventos.some((e) => e.status === "PROCESSED")).toBe(false);
  });
});

describe("falha nossa não vira sucesso definitivo", () => {
  it("erro ao processar responde 500, e a reentrega reprocessa", async () => {
    comercial.falharPagamento = 1;
    const w = webhook();

    const primeira = await w.entregar();
    expect(primeira.status).toBe(500);
    expect(eventos[0].status).toBe("FAILED");

    const segunda = await w.entregar();
    expect(segunda.status).toBe(200);
    expect(segunda.corpo).not.toHaveProperty("duplicado");
    expect(comercial.pagamento).toHaveLength(2);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ status: "PROCESSED", attempts: 2 });

    // E depois de processado, volta a ser duplicata.
    const terceira = await w.entregar();
    expect(terceira.corpo).toMatchObject({ duplicado: true });
    expect(comercial.pagamento).toHaveLength(2);
  });

  it("duas reentregas simultâneas de um FAILED: só uma reprocessa", async () => {
    comercial.falharPagamento = 1;
    const w = webhook();
    await w.entregar();

    await Promise.all([w.entregar(), w.entregar()]);
    expect(comercial.pagamento).toHaveLength(2);
  });

  it("RECEIVED recente é outra entrega em andamento: não reprocessa", async () => {
    eventos.push({
      id: "andamento",
      provider: "mock",
      eventId: "137484971656",
      status: "RECEIVED",
      signatureValid: true,
      updatedAt: new Date(),
    });

    const r = await webhook().entregar();
    expect(r.corpo).toMatchObject({ duplicado: true });
    expect(efeitosComerciais()).toBe(0);
  });

  it("RECEIVED órfão (execução que morreu) é reprocessado", async () => {
    eventos.push({
      id: "orfao",
      provider: "mock",
      eventId: "137484971656",
      status: "RECEIVED",
      signatureValid: true,
      attempts: 0,
      updatedAt: new Date(Date.now() - RECEBIDO_ORFAO_MS - 1000),
    });

    const r = await webhook().entregar();
    expect(r.status).toBe(200);
    expect(comercial.pagamento).toEqual([PAGAMENTO]);
    expect(eventos[0].status).toBe("PROCESSED");
  });
});

describe("IPN legado", () => {
  it("?topic=payment&id=…: 200, IGNORED, nada comercial", async () => {
    const r = await ipn(null, `?topic=payment&id=${PAGAMENTO}`);

    expect(r.status).toBe(200);
    expect(efeitosComerciais()).toBe(0);
    expect(eventos[0]).toMatchObject({
      format: "IPN",
      status: "IGNORED",
      signatureValid: false,
      resourceId: PAGAMENTO,
      claimedEventId: `payment:${PAGAMENTO}`,
    });
    expect(eventos[0].eventId).toMatch(/^ipn:/);
  });

  it("corpo {topic, resource} com id puro — forma real de 10/09", async () => {
    const r = await ipn({ topic: "payment", resource: PAGAMENTO });
    expect(r.status).toBe(200);
    expect(efeitosComerciais()).toBe(0);
    expect(eventos[0]).toMatchObject({ format: "IPN", resourceId: PAGAMENTO });
  });

  it("corpo {topic, resource} com URL inteira de merchant_order", async () => {
    const r = await ipn({
      topic: "merchant_order",
      resource: "https://api.mercadolibre.com/merchant_orders/44343262753",
    });
    expect(r.status).toBe(200);
    expect(efeitosComerciais()).toBe(0);
    expect(eventos[0]).toMatchObject({
      format: "IPN",
      topic: "merchant_order",
      resourceId: "44343262753",
    });
  });

  it("não passa pela HMAC: cabeçalho de assinatura qualquer não muda nada", async () => {
    const r = await receberWebhook(
      provedor,
      JSON.stringify({ topic: "payment", resource: PAGAMENTO }),
      new Headers({ "x-signature": "ts=1,v1=abc", "x-request-id": "r" }),
      new URL("https://x/api/pagamentos/webhook"),
    );
    expect(r.status).toBe(200);
    expect(eventos[0]).toMatchObject({ format: "IPN", status: "IGNORED" });
  });

  it("preapproval antigo mandando IPN: ignorado com segurança", async () => {
    const r = await ipn(null, "?topic=preapproval&id=pre-antigo");
    expect(r.status).toBe(200);
    expect(comercial.assinatura).toHaveLength(0);
  });

  it("repetido não gera retry nem efeito: sempre 200", async () => {
    await ipn({ topic: "payment", resource: PAGAMENTO });
    const r = await ipn({ topic: "payment", resource: PAGAMENTO });
    expect(r.status).toBe(200);
    expect(efeitosComerciais()).toBe(0);
  });

  it("IPN recebido antes não bloqueia o Webhook válido do mesmo recurso", async () => {
    await ipn(null, `?topic=payment&id=${PAGAMENTO}`);
    const r = await webhook().entregar();
    expect(r.status).toBe(200);
    expect(comercial.pagamento).toEqual([PAGAMENTO]);
  });
});

describe("observabilidade", () => {
  it("registra presença e forma, nunca o valor da assinatura", async () => {
    const w = webhook({ segredo: "segredo-errado" });
    await w.entregar();
    await webhook().entregar();

    for (const e of eventos) {
      expect(e.diagnostics).toEqual({
        formato: "WEBHOOK",
        hasXSignature: true,
        hasXRequestId: true,
        signatureHasTs: true,
        signatureHasV1: true,
        dataIdSource: "query-data.id",
        liveMode: true,
      });
    }

    const gravado = JSON.stringify(eventos);
    expect(gravado).not.toContain(w.v1);
    expect(gravado).not.toContain("v1=");
    expect(gravado).not.toContain(SEGREDO_MOCK);
  });

  it("dataIdSource aponta o ramo que forneceu o id", () => {
    const corpo = JSON.stringify({ id: 1, type: "payment", data: { id: "b" } });
    const h = new Headers();
    const origem = (q: string) =>
      lerNotificacao(corpo, h, new URL(`https://x/w${q}`), "s").diagnostico
        .dataIdSource;

    expect(origem("?data.id=a")).toBe("query-data.id");
    expect(origem("?id=a")).toBe("query-id");
    expect(origem("")).toBe("body-data.id");
  });

  it("sem id nenhum: dataIdSource nulo", () => {
    const lido = lerNotificacao(
      JSON.stringify({ type: "payment", data: {} }),
      new Headers(),
      new URL("https://x/w"),
      "s",
    );
    expect(lido.diagnostico.dataIdSource).toBeNull();
    expect(lido.assinaturaValida).toBe(false);
  });

  it("live_mode falso também é registrado", () => {
    const lido = lerNotificacao(
      JSON.stringify({ id: 1, type: "payment", live_mode: false, data: { id: "123456" } }),
      new Headers(),
      new URL("https://x/w?data.id=123456"),
      "s",
    );
    expect(lido.diagnostico.liveMode).toBe(false);
  });
});

describe("notification_url pede o formato Webhook", () => {
  it("acrescenta source_news=webhooks", () => {
    expect(comoWebhook("https://app.exemplo/api/pagamentos/webhook")).toBe(
      "https://app.exemplo/api/pagamentos/webhook?source_news=webhooks",
    );
  });

  it("preserva os parâmetros que já existem", () => {
    const url = new URL(comoWebhook("https://app.exemplo/w?a=1&b=dois")!);
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.get("b")).toBe("dois");
    expect(url.searchParams.get("source_news")).toBe("webhooks");
  });

  it("não duplica quando já está lá, e corrige valor diferente", () => {
    const url = new URL(comoWebhook("https://app.exemplo/w?source_news=ipn")!);
    expect(url.searchParams.getAll("source_news")).toEqual(["webhooks"]);
  });

  it("sem URL configurada continua sem URL", () => {
    expect(comoWebhook(null)).toBeNull();
  });

  it("a cobrança Pix enviada ao Mercado Pago leva a URL com source_news", async () => {
    const ambiente = { ...process.env };
    process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "segredo";
    process.env.MERCADOPAGO_NOTIFICATION_URL =
      "https://noveleiras-de-plantao.vercel.app/api/pagamentos/webhook";

    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/v1/payments") && init?.body) {
        corpos.push(JSON.parse(String(init.body)));
      }
      return new Response(
        JSON.stringify({ id: 1, status: "pending", tags: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
      await new MercadoPago().criarCompra({
        metodo: "PIX",
        valorCents: 990,
        referenciaExterna: "ref-1",
        idempotencyKey: "idem-1",
        novela: { id: "n1", titulo: "Novela" },
        usuario: { email: "pessoa@exemplo.com", nome: "Pessoa" },
      } as never);
    } finally {
      process.env = ambiente;
    }

    expect(corpos[0]?.notification_url).toBe(
      "https://noveleiras-de-plantao.vercel.app/api/pagamentos/webhook?source_news=webhooks",
    );
  });
});
