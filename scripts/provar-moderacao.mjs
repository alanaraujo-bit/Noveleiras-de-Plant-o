/**
 * Prova de ponta a ponta da moderação.
 *
 * Uma ação de servidor que compila não é uma ação que funciona: entre o botão
 * e a linha do banco existem confirmação, permissão, revalidação e auditoria.
 * Este script clica de verdade e depois lê o banco — se a denúncia não mudou
 * de estado ou a auditoria não registrou, ele falha.
 *
 * Descartável por natureza: existe porque o banco de desenvolvimento é o mesmo
 * de produção e um clique manual sem rastro seria pior.
 *
 *   node --env-file=.env scripts/provar-moderacao.mjs
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = "http://localhost:3100";
const db = new PrismaClient();

function falhar(mensagem) {
  console.error(`\n  FALHOU: ${mensagem}\n`);
  process.exitCode = 1;
}

async function cookie() {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET ausente. Rode com --env-file=.env");
  const admin = await db.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("Nenhum ADMIN ativo.");
  const token = await new SignJWT({ sid: "" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(segredo));
  return { token, admin };
}

async function main() {
  const denuncia = await db.report.findFirst({
    where: { state: { in: ["OPEN", "REVIEWING"] } },
    select: { id: true, state: true, targetId: true },
  });
  if (!denuncia) {
    console.log("\n  Nenhuma denúncia pendente para exercitar. Nada a provar.\n");
    return;
  }

  const { token, admin } = await cookie();
  console.log(`\n  operando como ${admin.email}`);
  console.log(`  denúncia ${denuncia.id} está ${denuncia.state}\n`);

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  await contexto.addCookies([
    { name: "nvl_sessao", value: token, url: BASE, httpOnly: true, sameSite: "Lax" },
  ]);

  const pagina = await contexto.newPage();
  const errosDeConsole = [];
  pagina.on("console", (m) => m.type() === "error" && errosDeConsole.push(m.text()));
  pagina.on("pageerror", (e) => errosDeConsole.push(e.message));

  await pagina.goto(`${BASE}/painel/comunidade`, { waitUntil: "networkidle" });

  // 1. abrir a confirmação
  await pagina.getByRole("button", { name: "Resolver" }).first().click();
  const dialogo = pagina.locator("dialog[open]");
  await dialogo.waitFor({ state: "visible", timeout: 5000 });
  console.log("  ✓ a confirmação abriu");

  // 2. o motivo vai para a auditoria; é o que transforma "alguém resolveu"
  //    em "foi resolvida por isto"
  const motivo = `prova automatizada ${new Date().toISOString()}`;
  const campo = dialogo.locator("textarea, input[type='text']").first();
  if (await campo.count()) await campo.fill(motivo);

  // 3. confirmar de verdade
  await dialogo.getByRole("button", { name: "Resolver", exact: true }).click();
  await pagina.waitForTimeout(2500);

  const depois = await db.report.findUnique({
    where: { id: denuncia.id },
    select: { state: true, resolvedAt: true, resolvedBy: true, resolution: true },
  });

  if (depois.state !== "RESOLVED") {
    falhar(`a denúncia continua ${depois.state}; o clique não gravou`);
  } else {
    console.log(`  ✓ estado gravado: ${denuncia.state} → ${depois.state}`);
  }
  if (!depois.resolvedAt || depois.resolvedBy !== admin.id) {
    falhar("o desfecho não carimbou data e autor");
  } else {
    console.log(`  ✓ carimbada por ${admin.email} em ${depois.resolvedAt.toISOString()}`);
  }
  if (depois.resolution !== motivo) {
    falhar(`o motivo não chegou ao banco (veio "${depois.resolution}")`);
  } else {
    console.log("  ✓ motivo preservado");
  }

  const trilha = await db.adminAudit.findFirst({
    where: { targetType: "Report", targetId: denuncia.id },
    orderBy: { createdAt: "desc" },
    select: { action: true, actorEmail: true, before: true, after: true },
  });
  if (!trilha) {
    falhar("a ação não deixou trilha de auditoria");
  } else {
    console.log(`  ✓ auditoria: ${trilha.action} por ${trilha.actorEmail}`);
    console.log(`      antes  ${JSON.stringify(trilha.before)}`);
    console.log(`      depois ${JSON.stringify(trilha.after)}`);
  }

  // 4. a lista precisa refletir a mudança sem recarregar na mão
  const aindaNaFila = await pagina
    .getByText("Nenhuma denúncia esperando decisão")
    .count();
  console.log(
    aindaNaFila > 0
      ? "  ✓ a fila esvaziou na tela (revalidação funcionou)"
      : "  · a fila ainda mostra itens — pode haver outras pendentes",
  );

  if (errosDeConsole.length) {
    falhar(`erros de console: ${errosDeConsole.join(" | ")}`);
  } else {
    console.log("  ✓ nenhum erro de console\n");
  }

  await navegador.close();
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
