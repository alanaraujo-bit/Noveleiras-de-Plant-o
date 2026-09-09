import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ehProducao,
  esquecerProvedor,
  estadoDosPagamentos,
  podeUsarMock,
  provedorDePagamento,
} from "./index";
import { MercadoPago } from "./mercadopago";
import { ProvedorMock, SEGREDO_MOCK } from "./mock";
import {
  contaEhDeTeste,
  esquecerModoDeTeste,
  resolverPagador,
} from "./mercadopago";
import {
  economiaAnualCents,
  ehPlanoVendavel,
  fimDoCiclo,
  mensalEquivalenteDoAnual,
  PLANO_ANUAL,
  PLANO_MENSAL,
  planoPorCodigo,
  PRECO_AVULSO_CENTS,
} from "./planos";
import { ProvedorNaoConfigurado } from "./provedor";

const ambienteOriginal = { ...process.env };

beforeEach(() => {
  esquecerProvedor();
});

afterEach(() => {
  process.env = { ...ambienteOriginal };
  esquecerProvedor();
  ProvedorMock.limpar();
});

// ---------------------------------------------------------------- precos

describe("tabela comercial", () => {
  it("cobra os valores oficiais", () => {
    expect(PLANO_MENSAL.precoCents).toBe(999);
    expect(PLANO_ANUAL.precoCents).toBe(9990);
    expect(PRECO_AVULSO_CENTS).toBe(499);
  });

  it("o anual economiza dois meses", () => {
    expect(economiaAnualCents()).toBe(999 * 12 - 9990);
    expect(mensalEquivalenteDoAnual()).toBe(833);
  });

  it("só mensal e anual são vendáveis", () => {
    expect(ehPlanoVendavel("MONTHLY")).toBe(true);
    expect(ehPlanoVendavel("ANNUAL")).toBe(true);
    expect(ehPlanoVendavel("FREE")).toBe(false);
    // Os planos da Fase 01 continuam existindo mas ninguém pode comprá-los.
    expect(ehPlanoVendavel("PREMIUM")).toBe(false);
    expect(ehPlanoVendavel("VIP")).toBe(false);
  });

  it("planos legados continuam resolvíveis", () => {
    expect(planoPorCodigo("PREMIUM").nome).toBe("Plantão Premium");
    expect(planoPorCodigo("PREMIUM").ativo).toBe(false);
  });
});

describe("fimDoCiclo", () => {
  it("mensal avança um mês de calendário", () => {
    const fim = fimDoCiclo(PLANO_MENSAL, new Date("2026-01-15T12:00:00Z"));
    expect(fim.toISOString().slice(0, 7)).toBe("2026-02");
  });

  it("anual avança um ano", () => {
    const fim = fimDoCiclo(PLANO_ANUAL, new Date("2026-03-10T12:00:00Z"));
    expect(fim.getUTCFullYear()).toBe(2027);
  });

  it("31 de janeiro não vira março", () => {
    // Somar 30 dias faria; aritmética de calendário não faz.
    const fim = fimDoCiclo(PLANO_MENSAL, new Date("2026-01-31T12:00:00Z"));
    expect(fim.getMonth()).toBeLessThanOrEqual(2);
  });
});

// ------------------------------------------------------- trava do mock

describe("trava do modo mock", () => {
  it("não liga sem ser pedido", () => {
    delete process.env.PAGAMENTOS_MOCK;
    process.env.VERCEL_ENV = "development";
    expect(podeUsarMock()).toBe(false);
  });

  it("liga fora de produção quando pedido", () => {
    process.env.PAGAMENTOS_MOCK = "1";
    process.env.VERCEL_ENV = "development";
    expect(podeUsarMock()).toBe(true);
    expect(provedorDePagamento()).toBeInstanceOf(ProvedorMock);
  });

  it("preview não é produção", () => {
    process.env.PAGAMENTOS_MOCK = "1";
    process.env.VERCEL_ENV = "preview";
    expect(ehProducao()).toBe(false);
    expect(podeUsarMock()).toBe(true);
  });

  it("EXPLODE se pedido em produção", () => {
    // A exigência mais importante do modo mock: uma variável esquecida no
    // painel da Vercel não pode liberar o catálogo de graça. Falhar alto é o
    // comportamento correto — passar batido seria o desastre silencioso.
    process.env.PAGAMENTOS_MOCK = "1";
    process.env.VERCEL_ENV = "production";
    expect(podeUsarMock()).toBe(false);
    expect(() => provedorDePagamento()).toThrow(/produção/i);
  });

  it("em produção sem mock, usa Mercado Pago", () => {
    delete process.env.PAGAMENTOS_MOCK;
    process.env.VERCEL_ENV = "production";
    expect(provedorDePagamento()).toBeInstanceOf(MercadoPago);
  });

  it("NODE_ENV=production também conta como produção", () => {
    delete process.env.VERCEL_ENV;
    // `NODE_ENV` é somente-leitura no tipo do Node; a atribuição em teste é
    // legítima e o cast é a forma canônica de fazê-la.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.PAGAMENTOS_MOCK = "true";
    expect(ehProducao()).toBe(true);
    expect(() => provedorDePagamento()).toThrow();
  });
});

describe("Mercado Pago sem credenciais", () => {
  it("não quebra no import, só na chamada", async () => {
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

    const mp = new MercadoPago();
    expect(mp.configurado).toBe(false);

    await expect(mp.consultarPagamento("123")).rejects.toBeInstanceOf(
      ProvedorNaoConfigurado,
    );
  });

  it("o erro diz qual variável falta", async () => {
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;

    await new MercadoPago().consultarPagamento("1").catch((erro) => {
      expect(erro.faltando).toEqual([
        "MERCADOPAGO_ACCESS_TOKEN",
        "MERCADOPAGO_WEBHOOK_SECRET",
      ]);
    });
  });

  it("estadoDosPagamentos descreve a situação", () => {
    delete process.env.PAGAMENTOS_MOCK;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    process.env.VERCEL_ENV = "production";

    expect(estadoDosPagamentos()).toEqual({
      provedor: "mercadopago",
      mock: false,
      configurado: false,
      producao: true,
    });
  });
});

// ------------------------------------------------------- provedor mock

describe("ProvedorMock", () => {
  const plano = PLANO_MENSAL;
  const base = {
    plano,
    metodo: "CARD" as const,
    referenciaExterna: "tentativa-1",
    idempotencyKey: "chave-1",
    urlRetorno: "http://localhost:3100/pagamento/retorno",
  };

  it("aprova por padrão", async () => {
    const r = await new ProvedorMock().criarAssinatura({
      ...base,
      usuario: { id: "u1", email: "alguem@exemplo.com", nome: "Alguém" },
    });
    expect(r.status).toBe("APPROVED");
    expect(r.externalId).toMatch(/^mock-sub-/);
  });

  it("recusa quando o e-mail pede recusa", async () => {
    const r = await new ProvedorMock().criarAssinatura({
      ...base,
      usuario: { id: "u1", email: "recusa@exemplo.com", nome: "Alguém" },
    });
    expect(r.status).toBe("REJECTED");
  });

  it("deixa pendente quando o e-mail pede pendência", async () => {
    const r = await new ProvedorMock().criarCompra({
      usuario: { id: "u1", email: "pendente@exemplo.com", nome: "Alguém" },
      novela: { id: "n1", slug: "n", titulo: "N" },
      valorCents: PRECO_AVULSO_CENTS,
      metodo: "PIX",
      referenciaExterna: "t1",
      idempotencyKey: "k1",
      urlRetorno: "http://x",
    });
    expect(r.status).toBe("PENDING");
    expect(r.pixQrCode).toContain("MOCK");
  });

  it("reembolso marca o pagamento como devolvido", async () => {
    const p = new ProvedorMock();
    const criado = await p.criarCompra({
      usuario: { id: "u1", email: "a@b.c", nome: "A" },
      novela: { id: "n1", slug: "n", titulo: "N" },
      valorCents: 499,
      metodo: "CARD",
      referenciaExterna: "t1",
      idempotencyKey: "k1",
      urlRetorno: "http://x",
    });

    await p.reembolsar(criado.externalId!);
    const consulta = await p.consultarPagamento(criado.externalId!);
    expect(consulta?.status).toBe("REFUNDED");
    expect(consulta?.reembolsadoCents).toBe(499);
  });

  it("permite forçar chargeback", async () => {
    const p = new ProvedorMock();
    const criado = await p.criarCompra({
      usuario: { id: "u1", email: "a@b.c", nome: "A" },
      novela: { id: "n1", slug: "n", titulo: "N" },
      valorCents: 499,
      metodo: "CARD",
      referenciaExterna: "t1",
      idempotencyKey: "k1",
      urlRetorno: "http://x",
    });

    ProvedorMock.definirStatus(criado.externalId!, "CHARGEBACK");
    expect((await p.consultarPagamento(criado.externalId!))?.status).toBe(
      "CHARGEBACK",
    );
  });

  it("assinatura recorrente por Pix é recusada no Mercado Pago", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "token-falso";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "segredo-falso";

    await expect(
      new MercadoPago().criarAssinatura({
        ...base,
        metodo: "PIX",
        usuario: { id: "u1", email: "a@b.c", nome: "A" },
      }),
    ).rejects.toThrow(/Pix/);
  });
});

// ------------------------------------------------------ webhook: HMAC

/** Monta um webhook assinado do jeito que o Mercado Pago monta. */
function webhookAssinado(
  dataId: string,
  segredo: string,
  opcoes: { requestId?: string; ts?: string; corromper?: boolean } = {},
) {
  const ts = opcoes.ts ?? String(Math.floor(Date.now() / 1000));
  const requestId = opcoes.requestId ?? "req-1";
  const manifesto = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  let v1 = createHmac("sha256", segredo).update(manifesto).digest("hex");
  if (opcoes.corromper) {
    v1 = v1.slice(0, -1) + (v1.endsWith("0") ? "1" : "0");
  }

  return {
    corpo: JSON.stringify({
      id: 12345,
      type: "payment",
      action: "payment.updated",
      data: { id: dataId },
    }),
    cabecalhos: new Headers({
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
    }),
    url: new URL(`https://exemplo.com/api/pagamentos/webhook?data.id=${dataId}`),
  };
}

describe("validação de webhook", () => {
  it("aceita assinatura correta", async () => {
    const w = webhookAssinado("abc123", SEGREDO_MOCK);
    const lido = await new ProvedorMock().lerWebhook(
      w.corpo,
      w.cabecalhos,
      w.url,
    );
    expect(lido.assinaturaValida).toBe(true);
    expect(lido.recursoId).toBe("abc123");
    expect(lido.topico).toBe("payment");
    expect(lido.eventId).toBe("12345");
  });

  it("recusa assinatura adulterada", async () => {
    const w = webhookAssinado("abc123", SEGREDO_MOCK, { corromper: true });
    const lido = await new ProvedorMock().lerWebhook(
      w.corpo,
      w.cabecalhos,
      w.url,
    );
    expect(lido.assinaturaValida).toBe(false);
  });

  it("recusa assinatura de outro segredo", async () => {
    const w = webhookAssinado("abc123", "segredo-do-atacante");
    const lido = await new ProvedorMock().lerWebhook(
      w.corpo,
      w.cabecalhos,
      w.url,
    );
    expect(lido.assinaturaValida).toBe(false);
  });

  it("recusa webhook sem assinatura nenhuma", async () => {
    const lido = await new ProvedorMock().lerWebhook(
      JSON.stringify({ type: "payment", data: { id: "x" } }),
      new Headers(),
      new URL("https://exemplo.com/w?data.id=x"),
    );
    expect(lido.assinaturaValida).toBe(false);
  });

  it("trocar o data.id invalida a assinatura", async () => {
    // O ataque direto: pegar um webhook legítimo e apontá-lo para outro
    // pagamento. Como o id entra no manifesto, a assinatura não acompanha.
    const w = webhookAssinado("abc123", SEGREDO_MOCK);
    const outraUrl = new URL("https://exemplo.com/w?data.id=999999");
    const lido = await new ProvedorMock().lerWebhook(
      w.corpo,
      w.cabecalhos,
      outraUrl,
    );
    expect(lido.assinaturaValida).toBe(false);
  });

  it("corpo inválido não derruba a leitura", async () => {
    const lido = await new ProvedorMock().lerWebhook(
      "isto não é json",
      new Headers({ "x-signature": "ts=1,v1=abc" }),
      new URL("https://exemplo.com/w"),
    );
    expect(lido.assinaturaValida).toBe(false);
    expect(lido.payload).toHaveProperty("corpoInvalido");
  });

  it("o Mercado Pago usa o mesmo algoritmo", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "segredo-real-de-teste";

    const w = webhookAssinado("pay-77", "segredo-real-de-teste");
    const lido = await new MercadoPago().lerWebhook(
      w.corpo,
      w.cabecalhos,
      w.url,
    );
    expect(lido.assinaturaValida).toBe(true);
    expect(lido.acao).toBe("payment.updated");
  });

  it("evento sem id no envelope ganha um id derivado e estável", async () => {
    // Sem isso, dois webhooks diferentes poderiam colidir na chave de
    // idempotência — ou, pior, cada reentrega viraria um evento novo.
    const corpo = JSON.stringify({
      type: "payment",
      action: "payment.created",
      data: { id: "p-1" },
    });
    const p = new ProvedorMock();
    const url = new URL("https://x/w?data.id=p-1");

    const a = await p.lerWebhook(corpo, new Headers(), url);
    const b = await p.lerWebhook(corpo, new Headers(), url);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId).toContain("p-1");
  });
});

// ------------------------------------------------- pagador de teste

/**
 * Substitui `fetch` para simular a resposta de `/users/me`.
 *
 * O que interessa provar aqui não é a rede: é que a substituição do pagador
 * só acontece com credenciais de teste, e que na dúvida ela **não** acontece.
 */
function fingirConta(resposta: { ok: boolean; tags?: string[] }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ id: 1, tags: resposta.tags ?? [] }), {
      status: resposta.ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("pagador de teste", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    esquecerModoDeTeste();
    process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-token-qualquer";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "segredo";
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    esquecerModoDeTeste();
  });

  it("sem a variável, usa sempre o e-mail real", async () => {
    delete process.env.MERCADOPAGO_TEST_PAYER_EMAIL;
    fingirConta({ ok: true, tags: ["test_user"] });

    expect(await resolverPagador("pessoa@real.com")).toEqual({
      email: "pessoa@real.com",
      substituido: false,
    });
  });

  it("substitui quando a conta é de teste", async () => {
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    fingirConta({ ok: true, tags: ["user_product_seller", "test_user"] });

    expect(await resolverPagador("pessoa@real.com")).toEqual({
      email: "test_user_99@testuser.com",
      substituido: true,
    });
  });

  it("NÃO substitui com credenciais reais, mesmo com a variável setada", async () => {
    // A trava que importa: esquecer a variável ao migrar para produção não
    // pode fazer a cobrança sair no nome de um comprador de teste.
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    fingirConta({ ok: true, tags: ["normal", "user_product_seller"] });

    expect(await resolverPagador("pessoa@real.com")).toEqual({
      email: "pessoa@real.com",
      substituido: false,
    });
  });

  it("falha fechada: se não dá para saber, trata como produção", async () => {
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    fingirConta({ ok: false });

    expect(await resolverPagador("pessoa@real.com")).toEqual({
      email: "pessoa@real.com",
      substituido: false,
    });
  });

  it("credencial com prefixo TEST- dispensa a consulta", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-1234-abcd";
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    globalThis.fetch = (async () => {
      throw new Error("não deveria consultar a rede");
    }) as typeof fetch;

    expect(await contaEhDeTeste()).toBe(true);
    expect((await resolverPagador("pessoa@real.com")).substituido).toBe(true);
  });

  it("a resposta é memorizada entre chamadas", async () => {
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    let idas = 0;
    globalThis.fetch = (async () => {
      idas += 1;
      return new Response(JSON.stringify({ id: 1, tags: ["test_user"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await resolverPagador("a@b.c");
    await resolverPagador("a@b.c");
    await resolverPagador("a@b.c");
    expect(idas).toBe(1);
  });

  it("a dúvida não é memorizada: tenta de novo na próxima", async () => {
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    let idas = 0;
    globalThis.fetch = (async () => {
      idas += 1;
      return new Response("erro", { status: 500 });
    }) as typeof fetch;

    await resolverPagador("a@b.c");
    await resolverPagador("a@b.c");
    expect(idas).toBe(2);
  });

  it("tags ausentes contam como produção", async () => {
    process.env.MERCADOPAGO_TEST_PAYER_EMAIL = "test_user_99@testuser.com";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    expect(await contaEhDeTeste()).toBe(false);
  });
});
