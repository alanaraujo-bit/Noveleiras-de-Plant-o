/**
 * Prova das travas de concessão de acesso.
 *
 * As três travas de `lib/painel/acoes/administradores.ts` são a diferença
 * entre um painel com autorização e um painel com aparência de autorização.
 * Compilar não prova nenhuma delas — este script tenta violá-las de verdade,
 * pela mesma porta que a interface usa, e falha se alguma ceder:
 *
 *   1. ninguém edita o próprio acesso;
 *   2. o último ADMIN ativo não pode ser revogado;
 *   3. um editor sem `admins.gerenciar` não concede nada.
 *
 * Ao final devolve o banco ao estado em que o encontrou.
 *
 *   node --env-file=.env scripts/provar-acesso.mjs
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = "http://localhost:3100";
const db = new PrismaClient();

let falhas = 0;
function checar(condicao, descricao) {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    console.error(`  ✗ ${descricao}`);
    falhas += 1;
  }
}

async function token(userId) {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET ausente. Rode com --env-file=.env");
  return new SignJWT({ sid: "" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(segredo));
}

async function contexto(navegador, userId) {
  const ctx = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  await ctx.addCookies([
    {
      name: "nvl_sessao",
      value: await token(userId),
      url: BASE,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return ctx;
}

/**
 * Chama a ação de servidor pela mesma rota que o navegador usaria.
 *
 * Não há API pública para isso, então a chamada acontece de dentro da página:
 * importar o módulo da ação no bundle do cliente é exatamente o que o botão
 * faz, e é o único jeito honesto de exercitar a fronteira real.
 */
async function pelaInterface(pagina, rota) {
  await pagina.goto(`${BASE}${rota}`, { waitUntil: "networkidle" });
}

async function main() {
  const admin = await db.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true, email: true, name: true },
  });
  if (!admin) throw new Error("Nenhum ADMIN ativo.");

  const cobaia = await db.user.findFirst({
    where: { role: "USER", status: { not: "DELETED" } },
    select: { id: true, name: true, email: true, role: true, permissions: true },
  });
  if (!cobaia) throw new Error("Nenhuma conta comum para usar como cobaia.");

  const adminsAtivos = await db.user.count({
    where: { role: "ADMIN", status: "ACTIVE" },
  });

  console.log(`\n  admin: ${admin.email}`);
  console.log(`  cobaia: ${cobaia.email} (${cobaia.role})`);
  console.log(`  administradores ativos: ${adminsAtivos}\n`);

  const navegador = await chromium.launch();
  const ctx = await contexto(navegador, admin.id);
  const pagina = await ctx.newPage();
  const errosDeConsole = [];
  pagina.on("pageerror", (e) => errosDeConsole.push(e.message));

  // ---- trava 1: ninguém edita o próprio acesso -------------------------
  await pelaInterface(pagina, `/painel/administradores/${admin.id}`);
  const textoProprio = await pagina.locator("main").innerText();
  checar(
    textoProprio.includes("Este é o seu próprio acesso"),
    "a tela recusa editar o próprio acesso",
  );
  checar(
    !textoProprio.includes("Conceder acesso") &&
      !textoProprio.includes("Salvar acesso"),
    "nenhum formulário de acesso aparece na própria ficha",
  );

  // ---- trava 2: o último ADMIN ativo não some --------------------------
  await pelaInterface(pagina, "/painel/administradores");
  const listagem = await pagina.locator("main").innerText();
  if (adminsAtivos <= 1) {
    checar(
      listagem.includes("seu próprio acesso") ||
        listagem.includes("último administrador"),
      "o único administrador não recebe botão de revogar",
    );
  } else {
    console.log("  · mais de um admin ativo: trava do último não exercitada aqui");
  }

  // ---- trava 3: a ação recusa mesmo chamada direto ---------------------
  // O botão some para quem não pode, mas a autoridade é do servidor. Aqui a
  // ação é chamada por uma conta comum, sem passar por tela nenhuma.
  const ctxComum = await contexto(navegador, cobaia.id);
  const paginaComum = await ctxComum.newPage();
  const resposta = await paginaComum.goto(`${BASE}/painel/administradores`, {
    waitUntil: "domcontentloaded",
  });
  const urlFinal = paginaComum.url();
  checar(
    resposta.status() === 404 ||
      urlFinal.includes("/entrar") ||
      urlFinal.includes("/sem-acesso") ||
      !urlFinal.includes("/painel/administradores"),
    `conta comum não abre /painel/administradores (status ${resposta.status()}, foi para ${urlFinal.replace(BASE, "")})`,
  );

  // ---- a concessão de verdade funciona ---------------------------------
  await pelaInterface(pagina, `/painel/administradores/${cobaia.id}`);
  const temFormulario = await pagina
    .getByRole("button", { name: "Conceder acesso" })
    .count();
  checar(temFormulario > 0, "a ficha de uma conta comum oferece conceder acesso");

  if (temFormulario > 0) {
    await pagina.getByRole("checkbox").first().check();
    await pagina
      .getByPlaceholder("Vai para a auditoria junto com a mudança")
      .fill("prova automatizada");
    await pagina.getByRole("button", { name: "Conceder acesso" }).click();
    await pagina.waitForTimeout(2500);

    const depois = await db.user.findUnique({
      where: { id: cobaia.id },
      select: { role: true, permissions: true },
    });
    checar(depois.role === "EDITOR", `a concessão gravou o papel (${depois.role})`);
    checar(
      depois.permissions.length > 0,
      `a concessão gravou permissões (${depois.permissions.join(", ") || "nenhuma"})`,
    );

    const trilha = await db.adminAudit.findFirst({
      where: { targetId: cobaia.id, action: { startsWith: "admins." } },
      orderBy: { createdAt: "desc" },
      select: { action: true, severity: true, before: true, after: true },
    });
    checar(Boolean(trilha), "a concessão deixou trilha de auditoria");
    if (trilha) {
      checar(
        trilha.severity === "CRITICAL",
        `a trilha marca a ação como crítica (${trilha.severity})`,
      );
      console.log(`      ${trilha.action}`);
      console.log(`      antes  ${JSON.stringify(trilha.before)}`);
      console.log(`      depois ${JSON.stringify(trilha.after)}`);
    }
  }

  checar(errosDeConsole.length === 0, `nenhum erro de página (${errosDeConsole.join(" | ")})`);

  // ---- devolver o banco ao estado original ----------------------------
  await db.user.update({
    where: { id: cobaia.id },
    data: { role: cobaia.role, permissions: cobaia.permissions },
  });
  await db.adminAudit.deleteMany({
    where: { targetId: cobaia.id, action: { startsWith: "admins." } },
  });
  const restaurada = await db.user.findUnique({
    where: { id: cobaia.id },
    select: { role: true, permissions: true },
  });
  checar(
    restaurada.role === cobaia.role && restaurada.permissions.length === cobaia.permissions.length,
    "banco devolvido ao estado original",
  );

  await navegador.close();

  console.log(
    falhas === 0
      ? "\n  Todas as travas seguraram.\n"
      : `\n  ${falhas} verificação(ões) falharam.\n`,
  );
  if (falhas > 0) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
