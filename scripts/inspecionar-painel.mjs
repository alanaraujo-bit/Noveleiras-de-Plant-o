/**
 * Inspeção visual do painel administrativo.
 *
 * Diferente de `inspecionar.mjs`, que fotografa o aplicativo em tela de
 * celular, este abre o painel nas três larguras que importam para operação:
 * desktop (onde o trabalho acontece), tablet e celular.
 *
 * Autenticação: em vez de entrar com e-mail e senha, assina localmente um
 * cookie de sessão para uma conta que já é administradora, usando o
 * SESSION_SECRET do ambiente. É proposital — a alternativa seria promover a
 * conta de demonstração, cuja senha está publicada no README, e o banco de
 * desenvolvimento é o mesmo de produção.
 *
 * Uso: npm run painel:inspecionar
 *      npm run painel:inspecionar -- --rotas=/painel,/painel/usuarios
 *      npm run painel:inspecionar -- --largura=desktop --inteira
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const arg = (nome, padrao) => {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};

const BASE = arg("base", "http://localhost:3100");
const SAIDA = arg("saida", "capturas/painel");
const INTEIRA = process.argv.includes("--inteira");

const TELAS = {
  desktop: { largura: 1440, altura: 900 },
  tablet: { largura: 834, altura: 1112 },
  celular: { largura: 390, altura: 844 },
};

const telasPedidas = arg("largura", "")
  ? arg("largura", "").split(",").filter((t) => t in TELAS)
  : Object.keys(TELAS);

const ROTAS_PADRAO = [
  "/painel",
  "/painel/usuarios",
  "/painel/streaming",
  "/painel/catalogo",
  "/painel/midia",
  "/painel/servidor",
  "/painel/transcodificacao",
  "/painel/financeiro",
  "/painel/comunidade",
  "/painel/descoberta",
  "/painel/logs",
  "/painel/auditoria",
  "/painel/alertas",
  "/painel/administradores",
];

const rotas = arg("rotas", "")
  ? arg("rotas", "").split(",").filter(Boolean)
  : ROTAS_PADRAO;

function nomeArquivo(rota, tela) {
  const limpo =
    rota.replace(/^\/painel\/?/, "").replace(/[/?=&]+/g, "-") || "visao-geral";
  return `${limpo}--${tela}.png`;
}

async function cookieDeSessao() {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo || segredo.length < 24) {
    throw new Error("SESSION_SECRET ausente. Rode com --env-file=.env");
  }

  const db = new PrismaClient();
  const admin = await db.user.findFirst({
    where: { role: { in: ["ADMIN", "EDITOR"] }, status: "ACTIVE" },
    orderBy: { role: "asc" },
    select: { id: true, email: true, role: true },
  });
  await db.$disconnect();

  if (!admin) {
    throw new Error(
      "Nenhum administrador ativo. Rode: npm run admin -- promover seu@email.com",
    );
  }

  const token = await new SignJWT({ sid: "" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(segredo));

  return { token, admin };
}

async function main() {
  await mkdir(SAIDA, { recursive: true });
  const { token, admin } = await cookieDeSessao();
  console.log(`sessão assinada para ${admin.email} (${admin.role})\n`);

  const navegador = await chromium.launch();
  const problemas = [];

  for (const nomeTela of telasPedidas) {
    const { largura, altura } = TELAS[nomeTela];
    const contexto = await navegador.newContext({
      viewport: { width: largura, height: altura },
      deviceScaleFactor: nomeTela === "celular" ? 2 : 1,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      isMobile: nomeTela === "celular",
      hasTouch: nomeTela !== "desktop",
    });

    await contexto.addCookies([
      {
        name: "nvl_sessao",
        value: token,
        url: BASE,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    console.log(`── ${nomeTela} (${largura}×${altura})`);

    for (const rota of rotas) {
      const pagina = await contexto.newPage();
      pagina.on("console", (msg) => {
        if (msg.type() === "error") {
          problemas.push(`[${nomeTela} ${rota}] console: ${msg.text()}`);
        }
      });
      pagina.on("pageerror", (erro) =>
        problemas.push(`[${nomeTela} ${rota}] pageerror: ${erro.message}`),
      );

      const resposta = await pagina
        .goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded", timeout: 45000 })
        .catch((erro) => {
          problemas.push(`[${nomeTela} ${rota}] não abriu: ${erro.message}`);
          return null;
        });

      // Os gráficos medem o contêiner antes de desenhar; sem esta pausa a
      // captura pega a tela um quadro antes de existir gráfico nenhum.
      await pagina.waitForTimeout(1600);

      const estouro = await pagina
        .evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        .catch(() => 0);
      if (estouro > 1) {
        problemas.push(
          `[${nomeTela} ${rota}] rola na horizontal (${estouro}px a mais)`,
        );
      }

      const status = resposta?.status() ?? 0;
      if (status >= 400) {
        problemas.push(`[${nomeTela} ${rota}] respondeu ${status}`);
      }

      const caminho = join(SAIDA, nomeArquivo(rota, nomeTela));
      await pagina.screenshot({ path: caminho, fullPage: INTEIRA }).catch(() => {});
      console.log(`  ${String(status).padEnd(4)} ${rota}`);
      await pagina.close();
    }

    await contexto.close();
    console.log();
  }

  await navegador.close();

  if (problemas.length > 0) {
    console.log(`${problemas.length} problema(s):`);
    for (const problema of [...new Set(problemas)]) console.log(`  · ${problema}`);
    process.exitCode = 1;
  } else {
    console.log("Nenhum erro de console e nenhum estouro horizontal.");
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
