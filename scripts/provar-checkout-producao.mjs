/**
 * Exercita o checkout mensal contra a producao, com conta descartavel.
 *
 * Existe porque "configurei a variavel e fiz deploy" nao prova que o checkout
 * funciona — a resposta do Mercado Pago so aparece quando alguem clica. Em vez
 * de mandar a pessoa descobrir na tela, este script clica no lugar dela: cria
 * uma conta de prova, abre a cobranca pela mesma rota que o aplicativo usa, le
 * o que voltou e apaga tudo.
 *
 * Nao mexe em nenhuma conta existente e nao conclui pagamento nenhum: para na
 * criacao da cobranca, que e exatamente onde o 400 aparecia.
 *
 *   node --env-file=.env.local scripts/provar-checkout-producao.mjs
 */
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = process.env.PROVA_BASE ?? "https://noveleiras-de-plantao.vercel.app";
const db = new PrismaClient();

let userId = null;

function mascarar(texto) {
  if (typeof texto !== "string") return texto;
  return texto.replace(/[\w.+-]+@[\w.-]+/g, (e) => {
    const [local, dominio] = e.split("@");
    return `${local.slice(0, 2)}***@${dominio}`;
  });
}

async function main() {
  const sufixo = randomUUID().slice(0, 8);

  const usuario = await db.user.create({
    data: {
      email: `prova-checkout-${sufixo}@teste.local`,
      passwordHash: "prova-sem-login",
      name: "Prova Checkout",
      handle: `provack_${sufixo}`,
      isDemo: true,
    },
  });
  userId = usuario.id;

  const sessao = await db.appSession.create({
    data: { userId: usuario.id, deviceId: `prova-${sufixo}` },
  });

  const jwt = await new SignJWT({ sid: sessao.id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(usuario.id)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));

  console.log(`\nCheckout mensal em ${BASE}\n`);

  const resposta = await fetch(`${BASE}/api/pagamentos/checkout`, {
    method: "POST",
    headers: {
      cookie: `nvl_sessao=${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tipo: "assinatura", plano: "MONTHLY" }),
  });

  const corpo = await resposta.json().catch(() => null);

  console.log(`  HTTP ${resposta.status}`);
  console.log(`  corpo: ${mascarar(JSON.stringify(corpo))}\n`);

  const tentativa = await db.paymentAttempt.findFirst({
    where: { userId: usuario.id },
    orderBy: { createdAt: "desc" },
  });

  if (tentativa) {
    console.log("  tentativa gravada:");
    console.log(`    status        ${tentativa.status}`);
    console.log(`    provider      ${tentativa.provider}`);
    console.log(`    externalId    ${tentativa.externalId ?? "(nenhum)"}`);
    console.log(`    isDemo        ${tentativa.isDemo}`);
    console.log(`    checkoutUrl   ${tentativa.checkoutUrl ?? "(nenhum)"}`);
    if (tentativa.failureMessage) {
      console.log(`    falha         ${mascarar(tentativa.failureMessage)}`);
    }
  }

  const ok = resposta.status === 200 && Boolean(corpo?.checkoutUrl);
  console.log(
    `\n  ${ok ? "CHECKOUT ABRIU" : "CHECKOUT NAO ABRIU"}\n`,
  );
  return ok ? 0 : 1;
}

let saida = 1;
try {
  saida = await main();
} catch (erro) {
  console.error(`\n  erro: ${mascarar(erro.message)}\n`);
} finally {
  if (userId) {
    await db.entitlement.deleteMany({ where: { userId } });
    await db.payment.deleteMany({ where: { userId } });
    await db.paymentAttempt.deleteMany({ where: { userId } });
    await db.purchase.deleteMany({ where: { userId } });
    await db.subscriptionEvent.deleteMany({ where: { userId } });
    await db.subscription.deleteMany({ where: { userId } });
    await db.event.deleteMany({ where: { userId } });
    await db.appSession.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => {});
    console.log("  conta de prova removida\n");
  }
  await db.$disconnect();
}

process.exit(saida);
