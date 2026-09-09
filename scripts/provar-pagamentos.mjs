/**
 * Prova da camada comercial, pela mesma porta que o aplicativo usa.
 *
 * Compilar não prova paywall. Teste de unidade prova a regra isolada, mas não
 * prova que a rota a aplica, que a sessão carrega os direitos certos, nem que
 * um webhook reentregue não libera acesso duas vezes. Este script exercita
 * tudo isso por HTTP, contra o servidor rodando, e falha se alguma trava
 * ceder.
 *
 * Cenários cobertos (a definição de pronto da fase):
 *   1. usuário gratuito vê 5 episódios e para no sexto
 *   2. assinatura mensal libera o catálogo
 *   3. assinatura anual idem
 *   4. compra avulsa libera uma obra e só ela
 *   5. cancelamento mantém o acesso até o fim do ciclo
 *   6. expiração corta o acesso geral
 *   7. compra avulsa sobrevive à expiração da assinatura
 *   8. pagamento recusado não libera nada
 *   9. webhook duplicado não concede acesso duas vezes
 *  10. webhook forjado é recusado
 *  11. reembolso revoga o direito
 *  12. adulteração de id não lê cobrança alheia
 *
 * Ao final devolve o banco ao estado em que o encontrou: as contas de teste e
 * tudo que penduraram são apagadas.
 *
 *   npm run dev                                   (noutro terminal)
 *   node --env-file=.env.local --env-file=.env.development.local \
 *     scripts/provar-pagamentos.mjs
 */
import { createHmac, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = process.env.PROVA_BASE ?? "http://localhost:3100";
const SEGREDO_MOCK = "mock-webhook-secret";

const db = new PrismaClient();

let falhas = 0;
let checados = 0;

function checar(condicao, descricao) {
  checados += 1;
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    console.error(`  ✗ ${descricao}`);
    falhas += 1;
  }
}

function secao(titulo) {
  console.log(`\n${titulo}`);
}

async function token(userId, sessionId) {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET ausente");
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(segredo));
}

/** Faz um pedido autenticado como a pessoa indicada. */
async function comoUsuario(usuario, caminho, init = {}) {
  const jwt = await token(usuario.id, usuario.sessionId);
  return fetch(`${BASE}${caminho}`, {
    ...init,
    headers: {
      cookie: `nvl_sessao=${jwt}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// ------------------------------------------------------------ preparacao

const criados = [];

async function criarUsuario(rotulo, email) {
  const sufixo = randomUUID().slice(0, 8);
  const usuario = await db.user.create({
    data: {
      email: email ?? `prova-${sufixo}@teste.local`,
      // Hash inválido de propósito: estas contas nunca fazem login por senha.
      passwordHash: "prova-sem-login",
      name: `Prova ${rotulo}`,
      handle: `prova_${sufixo}`,
      isDemo: true,
    },
  });

  const sessao = await db.appSession.create({
    data: { userId: usuario.id, deviceId: `prova-${sufixo}` },
  });

  criados.push(usuario.id);
  return { ...usuario, sessionId: sessao.id };
}

async function limpar() {
  for (const userId of criados) {
    // Ordem manual porque nem toda relação tem cascade — e um resto de linha
    // financeira contaminaria as métricas do painel.
    await db.entitlement.deleteMany({ where: { userId } });
    await db.refund.deleteMany({ where: { userId } });
    await db.payment.deleteMany({ where: { userId } });
    await db.paymentAttempt.deleteMany({ where: { userId } });
    await db.purchase.deleteMany({ where: { userId } });
    await db.subscriptionEvent.deleteMany({ where: { userId } });
    await db.subscription.deleteMany({ where: { userId } });
    await db.event.deleteMany({ where: { userId } });
    await db.appSession.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => {});
  }

  await db.webhookEvent.deleteMany({
    where: { eventId: { startsWith: "prova-" } },
  });
}

/** Uma novela com episódios suficientes para exercitar o paywall. */
async function escolherNovela(pular = []) {
  const novela = await db.novela.findFirst({
    where: { id: { notIn: pular }, episodes: { some: {} } },
    include: {
      episodes: {
        orderBy: [{ season: { number: "asc" } }, { number: "asc" }],
        select: { id: true, number: true },
      },
    },
  });
  if (!novela || novela.episodes.length < 8) {
    throw new Error("catálogo sem novela com 8+ episódios para a prova");
  }
  return novela;
}

async function statusDaMidia(usuario, episodeId) {
  const r = await comoUsuario(usuario, `/api/midia/${episodeId}`);
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

// ----------------------------------------------------------------- provas

async function main() {
  console.log(`\nProva da camada comercial — ${BASE}\n`);

  const saude = await fetch(`${BASE}/entrar`).catch(() => null);
  if (!saude?.ok) {
    throw new Error(`servidor não respondeu em ${BASE}. Rode \`npm run dev\`.`);
  }

  const novela = await escolherNovela();
  const outra = await escolherNovela([novela.id]);
  const ep5 = novela.episodes[4].id;
  const ep6 = novela.episodes[5].id;
  const ep6Outra = outra.episodes[5].id;

  console.log(`  novela da prova: ${novela.title} (${novela.episodes.length} eps)`);
  console.log(`  segunda novela:  ${outra.title}\n`);

  // ---------------------------------------------------------- 1. gratuito
  secao("1. Plano gratuito");
  const gratuito = await criarUsuario("gratuito");

  const quinto = await statusDaMidia(gratuito, ep5);
  checar(quinto.status === 200, "episódio 5 liberado");
  checar(quinto.corpo?.acesso === "gratuito", "e o motivo é a amostra grátis");

  const sexto = await statusDaMidia(gratuito, ep6);
  checar(sexto.status === 402, "episódio 6 bloqueado com 402");
  checar(sexto.corpo?.motivo === "precisa-pagar", "motivo: precisa pagar");
  checar(!sexto.corpo?.fonte, "e nenhuma URL de vídeo vazou na resposta");

  const semConta = await fetch(`${BASE}/api/midia/${ep5}`);
  checar(semConta.status === 401, "visitante sem conta recebe 401");

  // -------------------------------------------------------- 2. mensal
  secao("2. Assinatura mensal");
  const mensal = await criarUsuario("mensal");

  const compraMensal = await comoUsuario(mensal, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "assinatura", plano: "MONTHLY" }),
  });
  const dadosMensal = await compraMensal.json();
  checar(compraMensal.status === 200, "checkout aceito");
  checar(dadosMensal.status === "APPROVED", "mock aprovou na hora");

  await reconciliar(dadosMensal.attemptId);

  const liberado = await statusDaMidia(mensal, ep6);
  checar(liberado.status === 200, "episódio 6 liberado para assinante");
  checar(liberado.corpo?.acesso === "assinatura", "motivo: assinatura");

  const direitosMensal = await db.entitlement.findMany({
    where: { userId: mensal.id, status: "ACTIVE" },
  });
  checar(direitosMensal.length === 1, "exatamente um direito ativo");
  checar(
    direitosMensal[0]?.kind === "SUBSCRIPTION_MONTHLY",
    "do tipo SUBSCRIPTION_MONTHLY",
  );

  const assinaturaMensal = await db.subscription.findUnique({
    where: { userId: mensal.id },
  });
  const diasMensal = Math.round(
    (assinaturaMensal.currentPeriodEnd - Date.now()) / 86_400_000,
  );
  checar(diasMensal >= 27 && diasMensal <= 32, `ciclo de ~1 mês (${diasMensal}d)`);

  // ---------------------------------------------------------- 3. anual
  secao("3. Assinatura anual");
  const anual = await criarUsuario("anual");
  const compraAnual = await comoUsuario(anual, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "assinatura", plano: "ANNUAL" }),
  });
  const dadosAnual = await compraAnual.json();
  await reconciliar(dadosAnual.attemptId);

  const assinaturaAnual = await db.subscription.findUnique({
    where: { userId: anual.id },
  });
  const diasAnual = Math.round(
    (assinaturaAnual.currentPeriodEnd - Date.now()) / 86_400_000,
  );
  checar(diasAnual >= 360, `ciclo de ~12 meses (${diasAnual}d)`);
  checar(assinaturaAnual.priceCents === 9990, "preço gravado: R$ 99,90");
  checar((await statusDaMidia(anual, ep6)).status === 200, "catálogo liberado");

  // ------------------------------------------------------ 4. plano invalido
  secao("4. Plano forjado pelo cliente");
  const forjado = await comoUsuario(gratuito, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "assinatura", plano: "GRATIS_TOTAL" }),
  });
  checar(forjado.status === 400, "plano inexistente recusado com 400");

  const precoForjado = await comoUsuario(gratuito, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({
      tipo: "assinatura",
      plano: "MONTHLY",
      valorCents: 1,
      amountCents: 1,
    }),
  });
  const dadosPrecoForjado = await precoForjado.json();
  await reconciliar(dadosPrecoForjado.attemptId);
  const cobrado = await db.paymentAttempt.findUnique({
    where: { id: dadosPrecoForjado.attemptId },
  });
  checar(cobrado.amountCents === 999, "preço enviado pelo cliente é ignorado");

  // limpa o efeito colateral desta prova
  await db.entitlement.deleteMany({ where: { userId: gratuito.id } });
  await db.subscription.deleteMany({ where: { userId: gratuito.id } });

  // ------------------------------------------------------ 5. compra avulsa
  secao("5. Compra avulsa");
  const avulso = await criarUsuario("avulso");
  const compra = await comoUsuario(avulso, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "compra", novelaId: novela.id }),
  });
  const dadosCompra = await compra.json();
  checar(compra.status === 200, "checkout de compra aceito");
  await reconciliar(dadosCompra.attemptId);

  checar(
    (await statusDaMidia(avulso, ep6)).status === 200,
    "novela comprada liberada por inteiro",
  );
  const outraBloqueada = await statusDaMidia(avulso, ep6Outra);
  checar(outraBloqueada.status === 402, "outra novela continua bloqueada");
  checar(
    (await statusDaMidia(avulso, outra.episodes[0].id)).status === 200,
    "mas os 5 gratuitos dela seguem abertos",
  );

  const repetida = await comoUsuario(avulso, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "compra", novelaId: novela.id }),
  });
  checar(repetida.status === 409, "comprar de novo a mesma novela: 409");

  // -------------------------------------------------- 6. webhook duplicado
  secao("6. Webhook duplicado e forjado");
  const tentativaAvulsa = await db.paymentAttempt.findUnique({
    where: { id: dadosCompra.attemptId },
  });

  const primeira = await enviarWebhook(tentativaAvulsa.externalId, "prova-w1");
  const segunda = await enviarWebhook(tentativaAvulsa.externalId, "prova-w1");
  checar(primeira.status === 200, "primeira entrega aceita");
  checar(segunda.status === 200, "reentrega responde 200");
  checar((await segunda.json()).duplicado === true, "e é marcada como duplicada");

  const direitosAvulso = await db.entitlement.findMany({
    where: { userId: avulso.id, novelaId: novela.id, status: "ACTIVE" },
  });
  checar(direitosAvulso.length === 1, "continua havendo um único direito");

  const pagamentosAvulso = await db.payment.findMany({
    where: { userId: avulso.id, status: "APPROVED" },
  });
  checar(pagamentosAvulso.length === 1, "e um único pagamento registrado");
  checar(
    pagamentosAvulso[0]?.kind === "TITLE_PURCHASE",
    "classificado como venda de titulo, nao mensalidade",
  );
  checar(
    pagamentosAvulso[0]?.plan === null,
    "e sem plano associado, para o relatorio nao somar como assinatura",
  );

  const forjadoWebhook = await enviarWebhook(
    tentativaAvulsa.externalId,
    "prova-w2",
    { segredo: "segredo-do-atacante" },
  );
  checar(forjadoWebhook.status === 401, "webhook forjado recusado com 401");
  const registroForjado = await db.webhookEvent.findFirst({
    where: { eventId: "prova-w2" },
  });
  checar(
    registroForjado?.signatureValid === false,
    "e fica registrado para auditoria",
  );

  // ------------------------------------------------- 7. posse da cobranca
  secao("7. Cobrança alheia");
  const bisbilhoteiro = await criarUsuario("bisbilhoteiro");
  const alheia = await comoUsuario(
    bisbilhoteiro,
    `/api/pagamentos/estado/${dadosCompra.attemptId}`,
  );
  checar(alheia.status === 404, "estado de cobrança de outra pessoa: 404");

  // -------------------------------------------------------- 8. recusado
  secao("8. Pagamento recusado");
  const recusado = await criarUsuario("recusado", `recusa@teste-${randomUUID().slice(0, 6)}.local`);
  const tentativaRecusada = await comoUsuario(
    recusado,
    "/api/pagamentos/checkout",
    {
      method: "POST",
      body: JSON.stringify({ tipo: "assinatura", plano: "MONTHLY" }),
    },
  );
  const dadosRecusa = await tentativaRecusada.json();
  checar(dadosRecusa.status === "REJECTED", "mock recusou o cartão");
  await reconciliar(dadosRecusa.attemptId);

  checar(
    (await statusDaMidia(recusado, ep6)).status === 402,
    "e nada foi liberado",
  );
  checar(
    (await db.entitlement.count({ where: { userId: recusado.id } })) === 0,
    "nenhum direito criado",
  );

  // ------------------------------------------------------ 9. cancelamento
  secao("9. Cancelamento");
  const cancelou = await comoUsuario(mensal, "/api/pagamentos/assinatura", {
    method: "DELETE",
  });
  const dadosCancelamento = await cancelou.json();
  checar(cancelou.status === 200, "cancelamento aceito");
  checar(Boolean(dadosCancelamento.ativoAte), "informa até quando vale");
  checar(
    (await statusDaMidia(mensal, ep6)).status === 200,
    "acesso continua até o fim do ciclo pago",
  );

  const aposCancelar = await db.subscription.findUnique({
    where: { userId: mensal.id },
  });
  checar(aposCancelar.cancelAtPeriodEnd === true, "marcada para não renovar");

  // -------------------------------------------------------- 10. expiracao
  secao("10. Expiração");
  const ontem = new Date(Date.now() - 86_400_000);
  await db.subscription.update({
    where: { userId: mensal.id },
    data: { currentPeriodEnd: ontem, graceUntil: null },
  });
  await db.entitlement.updateMany({
    where: { userId: mensal.id, novelaId: null },
    data: { endsAt: ontem },
  });

  checar(
    (await statusDaMidia(mensal, ep6)).status === 402,
    "acesso cai assim que o ciclo vence, mesmo antes do cron",
  );

  const cron = await fetch(`${BASE}/api/cron/assinaturas`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  checar(cron.status === 200, "cron de expiração autorizado");

  const expirada = await db.subscription.findUnique({
    where: { userId: mensal.id },
  });
  checar(expirada.status === "EXPIRED", "assinatura marcada como expirada");
  checar(
    (await statusDaMidia(mensal, ep5)).status === 200,
    "e os 5 gratuitos voltam a valer",
  );

  const cronSemSegredo = await fetch(`${BASE}/api/cron/assinaturas`);
  checar(cronSemSegredo.status === 401, "cron sem segredo é recusado");

  // ------------------------------- 11. compra sobrevive ao fim da assinatura
  secao("11. Compra sobrevive ao fim da assinatura");
  const misto = await criarUsuario("misto");

  const assinaturaMisto = await comoUsuario(misto, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "assinatura", plano: "MONTHLY" }),
  });
  await reconciliar((await assinaturaMisto.json()).attemptId);

  const compraMisto = await comoUsuario(misto, "/api/pagamentos/checkout", {
    method: "POST",
    body: JSON.stringify({ tipo: "compra", novelaId: novela.id }),
  });
  await reconciliar((await compraMisto.json()).attemptId);

  await db.subscription.update({
    where: { userId: misto.id },
    data: { status: "EXPIRED", currentPeriodEnd: ontem, plan: "FREE" },
  });
  await db.entitlement.updateMany({
    where: { userId: misto.id, novelaId: null },
    data: { status: "EXPIRED" },
  });

  checar(
    (await statusDaMidia(misto, ep6)).status === 200,
    "novela comprada continua liberada",
  );
  checar(
    (await statusDaMidia(misto, ep6Outra)).status === 402,
    "mas o resto do catálogo fecha",
  );

  // -------------------------------------------------------- 12. reembolso
  secao("12. Reembolso");
  const tentativaMisto = await db.paymentAttempt.findFirst({
    where: { userId: misto.id, kind: "PURCHASE" },
  });

  const reembolso = await fetch(`${BASE}/api/pagamentos/simular`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      acao: "reembolsar",
      externalId: tentativaMisto.externalId,
    }),
  });
  checar(reembolso.status === 200, "reembolso simulado aceito");

  await enviarWebhook(tentativaMisto.externalId, "prova-w3");

  checar(
    (await statusDaMidia(misto, ep6)).status === 402,
    "direito revogado após o reembolso",
  );

  const linhaReembolso = await db.refund.findFirst({
    where: { userId: misto.id },
  });
  checar(Boolean(linhaReembolso), "reembolso registrado para auditoria");

  const compraReembolsada = await db.purchase.findFirst({
    where: { userId: misto.id },
  });
  checar(
    compraReembolsada.status === "REFUNDED",
    "compra marcada como reembolsada",
  );

  // O fato financeiro permanece: receita de mês fechado não some.
  const pagamentoPreservado = await db.payment.findFirst({
    where: { userId: misto.id, purchaseId: compraReembolsada.id },
  });
  checar(
    Boolean(pagamentoPreservado),
    "o pagamento original continua no histórico",
  );
}

/** Força a reconciliação como a tela de retorno faria. */
async function reconciliar(attemptId) {
  const tentativa = await db.paymentAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!tentativa?.externalId) return;
  await fetch(`${BASE}/api/pagamentos/simular`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      acao: "reconciliar",
      externalId: tentativa.externalId,
    }),
  });
}

/** Envia um webhook assinado como o Mercado Pago assina. */
async function enviarWebhook(dataId, eventId, opcoes = {}) {
  const segredo = opcoes.segredo ?? SEGREDO_MOCK;
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = `req-${eventId}`;
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", segredo).update(manifesto).digest("hex");

  return fetch(
    `${BASE}/api/pagamentos/webhook?data.id=${encodeURIComponent(dataId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": `ts=${ts},v1=${v1}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        id: eventId,
        type: "payment",
        action: "payment.updated",
        data: { id: dataId },
      }),
    },
  );
}

try {
  await main();
} catch (erro) {
  console.error(`\n  erro fatal: ${erro.message}`);
  falhas += 1;
} finally {
  await limpar();
  await db.$disconnect();
}

console.log(
  `\n${falhas === 0 ? "TUDO CERTO" : "FALHOU"} — ${checados - falhas}/${checados} verificações\n`,
);
process.exit(falhas === 0 ? 0 : 1);
