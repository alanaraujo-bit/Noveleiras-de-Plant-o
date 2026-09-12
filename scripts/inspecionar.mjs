/**
 * Inspeção visual em proporção real de smartphone.
 *
 * Abre o app num viewport de celular, entra com a conta de demonstração e
 * salva uma captura por rota, além de reportar erros de console. Ferramenta de
 * desenvolvimento — não faz parte do produto.
 *
 * Uso: node scripts/inspecionar.mjs [--base=http://localhost:3100] [--saida=dir]
 *      node scripts/inspecionar.mjs --rotas=/plantao,/buscar
 *      node scripts/inspecionar.mjs --largura=393 --altura=852
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices } from "playwright";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const arg = (nome, padrao) => {
  const encontrado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return encontrado ? encontrado.split("=").slice(1).join("=") : padrao;
};

const BASE = arg("base", "http://localhost:3100");
const SAIDA = arg("saida", "capturas");
const LARGURA = Number(arg("largura", 390));
const ALTURA = Number(arg("altura", 844));
const INTEIRA = process.argv.includes("--inteira");

const ROTAS_PADRAO = [
  "/bem-vindo",
  "/entrar",
  "/criar-conta",
  "/plantao",
  "/explorar",
  "/generos",
  "/feed",
  "/minha-lista",
  "/perfil",
];

const rotas = arg("rotas", "")
  ? arg("rotas", "").split(",").filter(Boolean)
  : ROTAS_PADRAO;

const PUBLICAS = new Set(["/bem-vindo", "/entrar", "/criar-conta"]);

function nomeArquivo(rota) {
  const limpo = rota.replace(/^\//, "").replace(/[/?=&]+/g, "-") || "raiz";
  return `${limpo}.png`;
}

async function main() {
  await mkdir(SAIDA, { recursive: true });
  const navegador = await chromium.launch();

  const contextoPadrao = {
    ...devices["iPhone 13"],
    viewport: { width: LARGURA, height: ALTURA },
    deviceScaleFactor: 2,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  };

  // Um contexto anônimo para as telas públicas e um autenticado para o app.
  const anonimo = await navegador.newContext(contextoPadrao);
  const logado = await navegador.newContext(contextoPadrao);

  const problemas = [];
  for (const contexto of [anonimo, logado]) {
    contexto.on("weberror", (erro) =>
      problemas.push(`[página] ${erro.error().message}`),
    );
  }

  // Assina um cookie de sessão para uma conta existente, em vez de digitar
  // credenciais. A conta de demonstração deixou de existir quando o catálogo
  // ficou real, e prender a inspeção a uma senha publicada seria um convite a
  // mantê-la viva por conveniência.
  const db = new PrismaClient();
  const pessoa = await db.user.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  await db.$disconnect();

  if (!pessoa) {
    problemas.push("[login] nenhuma conta ativa para inspecionar as telas internas");
  } else {
    const token = await new SignJWT({ sid: "" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(pessoa.id)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET ?? ""));
    await logado.addCookies([
      { name: "nvl_sessao", value: token, url: BASE, httpOnly: true, sameSite: "Lax" },
    ]);
    console.log(`sessão assinada para ${pessoa.email}`);
  }

  for (const rota of rotas) {
    const contexto = PUBLICAS.has(rota) ? anonimo : logado;
    const pagina = await contexto.newPage();
    pagina.on("console", (msg) => {
      if (msg.type() === "error") problemas.push(`[${rota}] ${msg.text()}`);
    });
    pagina.on("pageerror", (erro) =>
      problemas.push(`[${rota}] pageerror: ${erro.message}`),
    );

    const resposta = await pagina
      .goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch((erro) => {
        problemas.push(`[${rota}] falhou ao abrir: ${erro.message}`);
        return null;
      });

    await pagina.waitForTimeout(1400);

    // Confere se a página rola na horizontal — defeito clássico em mobile.
    const overflow = await pagina.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1) {
      problemas.push(`[${rota}] rola na horizontal (${overflow}px a mais)`);
    }

    const caminho = join(SAIDA, nomeArquivo(rota));
    await pagina.screenshot({ path: caminho, fullPage: INTEIRA });
    console.log(
      `${String(resposta?.status() ?? "erro").padEnd(4)} ${rota.padEnd(16)} → ${caminho}`,
    );
    await pagina.close();
  }

  await navegador.close();

  if (problemas.length > 0) {
    console.log(`\n${problemas.length} problema(s):`);
    for (const problema of [...new Set(problemas)]) console.log(`  · ${problema}`);
    process.exitCode = 1;
  } else {
    console.log("\nNenhum erro de console ou estouro horizontal.");
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
