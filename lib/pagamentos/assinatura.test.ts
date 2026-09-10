/**
 * A convergência dos três caminhos que ativam uma assinatura.
 *
 * O bug que estes testes existem para impedir: o webhook ativava a assinatura,
 * mas a página de retorno apenas carimbava `PaymentAttempt.status = APPROVED`.
 * Quem voltava do checkout ficava com a cobrança aprovada, plano FREE e nenhum
 * direito — e como o webhook do Mercado Pago podia simplesmente não chegar, o
 * acesso nunca aparecia. Havia dois caminhos para o mesmo evento e só um
 * concedia acesso.
 *
 * Agora existe um só: `reconciliarAssinatura`. O que se prova aqui é que ela
 * concede acesso sozinha, e que rodá-la de novo — por qualquer um dos três
 * caminhos, em qualquer ordem — não concede duas vezes.
 *
 * O banco é um duplo em memória, e de propósito **um duplo que sabe errar**:
 * `entitlement.create` sempre acrescenta uma linha, então uma concessão
 * duplicada apareceria como duas linhas ACTIVE e derrubaria o teste. Se ele
 * apenas devolvesse "ok" para tudo, os seis cenários passariam sem provar nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsultaAssinatura } from "./provedor";

// ------------------------------------------------------------ banco falso

type Linha = Record<string, unknown>;

const tabelas = {
  paymentAttempt: [] as Linha[],
  subscription: [] as Linha[],
  entitlement: [] as Linha[],
  subscriptionEvent: [] as Linha[],
};

/**
 * Compara uma linha com um `where` simples (igualdade campo a campo).
 *
 * Coluna que ninguém escreveu é `NULL` no Postgres, não `undefined`. Sem essa
 * equivalência, `where: { novelaId: null }` — que é como `concederAssinatura`
 * procura o direito de assinatura vigente — nunca acharia a linha que ela
 * mesma criou, e o duplo acusaria uma concessão duplicada que o banco de
 * verdade não faz.
 */
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
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: Linha;
      create: Linha;
      update: Linha;
    }) => {
      const linha = linhas().find((l) => casa(l, where));
      if (linha) {
        Object.assign(linha, update);
        return linha;
      }
      const nova = { id: novoId(nome), ...create };
      linhas().push(nova);
      return nova;
    },
  };
}

const bancoFalso = {
  paymentAttempt: tabela("paymentAttempt"),
  subscription: tabela("subscription"),
  entitlement: tabela("entitlement"),
  subscriptionEvent: tabela("subscriptionEvent"),
  // As duas formas que o código usa: callback e array de promessas.
  $transaction: async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => Promise<unknown>)(bancoFalso)
      : await Promise.all(arg as Promise<unknown>[]),
};

vi.mock("@/lib/db", () => ({ db: bancoFalso }));

// -------------------------------------------------------- provedor falso

let respostaDoProvedor: ConsultaAssinatura | null = null;
let consultas = 0;

vi.mock("./index", () => ({
  podeUsarMock: () => false,
  provedorDePagamento: () => ({
    nome: "mercadopago",
    consultarAssinatura: async () => {
      consultas += 1;
      return respostaDoProvedor;
    },
  }),
}));

const { reconciliarAssinatura } = await import("./servico");

// ------------------------------------------------------------- cenários

const USUARIO = "user-real-noveleiras";
const ATTEMPT = "attempt-1";
const PREAPPROVAL = "preapproval-abc";

function autorizada(): ConsultaAssinatura {
  return {
    externalId: PREAPPROVAL,
    status: "APPROVED",
    referenciaExterna: ATTEMPT,
    proximaCobranca: null,
    bruto: { status: "authorized" },
  };
}

function semear() {
  tabelas.paymentAttempt = [
    {
      id: ATTEMPT,
      userId: USUARIO,
      kind: "SUBSCRIPTION",
      status: "PENDING",
      plan: "MONTHLY",
      provider: "mercadopago",
      externalId: PREAPPROVAL,
      amountCents: 999,
      isDemo: true,
      purchaseId: null,
      novelaId: null,
    },
  ];
  // A conta já existe com o plano gratuito, como no banco de produção.
  tabelas.subscription = [
    {
      id: "sub-1",
      userId: USUARIO,
      plan: "FREE",
      status: "ACTIVE",
      provider: "interno",
      canceledAt: new Date("2026-09-08T18:04:54.047Z"),
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      externalPreapprovalId: null,
    },
  ];
  tabelas.entitlement = [];
  tabelas.subscriptionEvent = [];
}

const ativos = () =>
  tabelas.entitlement.filter((e) => e.status === "ACTIVE");
const tentativa = () => tabelas.paymentAttempt[0]!;
const assinatura = () => tabelas.subscription[0]!;

beforeEach(() => {
  semear();
  respostaDoProvedor = autorizada();
  consultas = 0;
});

describe("assinatura aprovada sem webhook nenhum", () => {
  it("a página de retorno sozinha já libera o acesso", async () => {
    const resultado = await reconciliarAssinatura(PREAPPROVAL);

    expect(resultado.mudou).toBe(true);
    expect(tentativa().status).toBe("APPROVED");
    expect(assinatura().plan).toBe("MONTHLY");
    expect(assinatura().status).toBe("ACTIVE");
    expect(assinatura().externalPreapprovalId).toBe(PREAPPROVAL);
    // Reativar não pode deixar para trás o cancelamento antigo: ACTIVE com
    // `canceledAt` preenchido é um estado meio-cancelado que ninguém lê certo.
    expect(assinatura().canceledAt).toBeNull();
    expect(assinatura().cancelAtPeriodEnd).toBe(false);

    expect(ativos()).toHaveLength(1);
    expect(ativos()[0]!.kind).toBe("SUBSCRIPTION_MONTHLY");
    // `RENEWED` e não `ACTIVATED` porque a linha gratuita já estava ACTIVE —
    // é como o banco de produção guarda quem nunca assinou. O que importa é
    // que o ciclo pago ficou registrado.
    expect(tabelas.subscriptionEvent).toHaveLength(1);
    expect(tabelas.subscriptionEvent[0]!.type).toBe("RENEWED");
    expect(tabelas.subscriptionEvent[0]!.toStatus).toBe("ACTIVE");
    expect(tabelas.subscriptionEvent[0]!.periodEnd).toBeInstanceOf(Date);
  });

  it("o direito pertence ao usuário do PaymentAttempt, não ao pagador do provedor", async () => {
    await reconciliarAssinatura(PREAPPROVAL);

    // O `payer_email` mandado ao Mercado Pago é o do Buyer Test User; o dono
    // do acesso continua sendo a conta real que clicou.
    expect(ativos()[0]!.userId).toBe(USUARIO);
    expect(assinatura().userId).toBe(USUARIO);
  });
});

describe("retorno seguido de webhook duplicado", () => {
  it("não concede duas vezes", async () => {
    await reconciliarAssinatura(PREAPPROVAL); // retorno do checkout
    await reconciliarAssinatura(PREAPPROVAL); // webhook chegando depois

    expect(ativos()).toHaveLength(1);
    expect(tabelas.subscription).toHaveLength(1);
  });

  it("a reentrega continua sendo evento tratado, e não ignorado", async () => {
    await reconciliarAssinatura(PREAPPROVAL);
    const reentrega = await reconciliarAssinatura(PREAPPROVAL);

    // `mudou` vira `WebhookEvent.status`. Se a segunda entrega devolvesse
    // `false`, o evento seria gravado como IGNORED e a auditoria mentiria.
    expect(reentrega.mudou).toBe(true);
    expect(reentrega.attemptId).toBe(ATTEMPT);
  });
});

describe("polling seguido de webhook", () => {
  it("converge para o mesmo estado, em qualquer ordem", async () => {
    await reconciliarAssinatura(PREAPPROVAL); // tela de espera
    const fimDoPolling = (ativos()[0]!.endsAt as Date).getTime();

    await reconciliarAssinatura(PREAPPROVAL); // webhook

    expect(ativos()).toHaveLength(1);
    // Igualdade exata, e não ">=": estender o ciclo a cada releitura da mesma
    // autorização daria um mês de graça por webhook reentregue. Foi assim que
    // o defeito passou despercebido na primeira versão deste teste.
    expect((ativos()[0]!.endsAt as Date).getTime()).toBe(fimDoPolling);
  });
});

describe("a pessoa fecha a aba antes de voltar do checkout", () => {
  it("a tentativa segue PENDING até alguém reconciliar, e então libera", async () => {
    // Ninguém passou pela página de retorno: nada mudou.
    expect(tentativa().status).toBe("PENDING");
    expect(ativos()).toHaveLength(0);

    // Mais tarde a tela de espera consulta — ou o webhook chega.
    await reconciliarAssinatura(PREAPPROVAL);

    expect(tentativa().status).toBe("APPROVED");
    expect(ativos()).toHaveLength(1);
  });
});

describe("assinatura já ativa", () => {
  it("reler a mesma autorização não regala um mês", async () => {
    await reconciliarAssinatura(PREAPPROVAL);
    const primeiroFim = (ativos()[0]!.endsAt as Date).getTime();
    const idDoDireito = ativos()[0]!.id;

    // Três releituras: retorno reaberto, webhook reentregue, tela de espera.
    await reconciliarAssinatura(PREAPPROVAL);
    await reconciliarAssinatura(PREAPPROVAL);
    await reconciliarAssinatura(PREAPPROVAL);

    expect(ativos()).toHaveLength(1);
    expect(ativos()[0]!.id).toBe(idDoDireito);
    expect((ativos()[0]!.endsAt as Date).getTime()).toBe(primeiroFim);
    // E nenhum evento de renovação inventado por releitura.
    expect(tabelas.subscriptionEvent).toHaveLength(1);
  });
});

describe("o que não concede acesso", () => {
  it("assinatura inexistente no provedor não toca em nada", async () => {
    respostaDoProvedor = null;

    const resultado = await reconciliarAssinatura(PREAPPROVAL);

    expect(resultado.mudou).toBe(false);
    expect(tentativa().status).toBe("PENDING");
    expect(ativos()).toHaveLength(0);
  });

  it("preapproval ainda pendente não libera o catálogo", async () => {
    respostaDoProvedor = { ...autorizada(), status: "PENDING" };

    const resultado = await reconciliarAssinatura(PREAPPROVAL);

    expect(resultado.mudou).toBe(false);
    expect(ativos()).toHaveLength(0);
    expect(assinatura().plan).toBe("FREE");
  });

  it("polling de preapproval pendente não rebaixa quem ainda nem assinou", async () => {
    respostaDoProvedor = { ...autorizada(), status: "PENDING" };

    // A tela de espera consulta várias vezes enquanto o cartão não autoriza.
    await reconciliarAssinatura(PREAPPROVAL);
    await reconciliarAssinatura(PREAPPROVAL);
    await reconciliarAssinatura(PREAPPROVAL);

    expect(assinatura().status).toBe("ACTIVE");
    expect(tabelas.subscriptionEvent).toHaveLength(0);
  });

  it("mas a assinatura paga que o provedor pausou perde o acesso", async () => {
    await reconciliarAssinatura(PREAPPROVAL); // ativa de verdade
    expect(ativos()).toHaveLength(1);

    respostaDoProvedor = { ...autorizada(), status: "PENDING" }; // paused
    const resultado = await reconciliarAssinatura(PREAPPROVAL);

    expect(resultado.mudou).toBe(true);
    expect(assinatura().status).toBe("PAST_DUE");
    expect(ativos()).toHaveLength(0);
  });

  it("cancelamento no provedor não corta o acesso do ciclo já pago", async () => {
    await reconciliarAssinatura(PREAPPROVAL);

    respostaDoProvedor = { ...autorizada(), status: "CANCELED" };
    await reconciliarAssinatura(PREAPPROVAL);

    expect(assinatura().cancelAtPeriodEnd).toBe(true);
    // Quem pagou até o fim do ciclo assiste até lá; o direito expira sozinho.
    expect(ativos()).toHaveLength(1);
  });

  it("sem tentativa correspondente não inventa dono para o direito", async () => {
    tabelas.paymentAttempt = [];

    const resultado = await reconciliarAssinatura(PREAPPROVAL);

    expect(resultado.mudou).toBe(false);
    expect(resultado.attemptId).toBeNull();
    expect(ativos()).toHaveLength(0);
  });

  it("sempre reconsulta o provedor — nunca decide pelo que chegou de fora", async () => {
    await reconciliarAssinatura(PREAPPROVAL);
    await reconciliarAssinatura(PREAPPROVAL);

    expect(consultas).toBe(2);
  });
});
