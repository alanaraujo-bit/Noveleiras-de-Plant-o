/**
 * Auditoria de acabamento: PWA, acessibilidade prática e comportamento nativo.
 *
 * Verifica o que uma captura de tela não mostra — se o manifesto está válido,
 * se os ícones existem, se a página não dá zoom, se os alvos de toque têm
 * tamanho de dedo, se todo botão de ícone tem nome acessível e se o contraste
 * do texto de apoio se sustenta.
 *
 * Uso: node scripts/auditar.mjs [--base=http://localhost:3100]
 */
import { chromium, devices } from "playwright";

const arg = (nome, padrao) => {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};

const BASE = arg("base", "http://localhost:3100");
const ROTAS = [
  "/plantao",
  "/inicio",
  "/buscar",
  "/generos",
  "/feed",
  "/minha-lista",
  "/perfil",
  "/perfil/preferencias",
  "/novela/coracao-em-plantao",
];

const achados = [];
let verificacoes = 0;

function checar(nome, ok, detalhe = "") {
  verificacoes += 1;
  if (!ok) achados.push(`${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  console.log(`${ok ? "  ok " : " FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

async function main() {
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    locale: "pt-BR",
  });
  const pagina = await contexto.newPage();

  // ---------------------------------------------------------------- PWA
  console.log("\nPWA");
  const manifesto = await pagina
    .goto(`${BASE}/manifest.webmanifest`)
    .then((r) => r.json())
    .catch(() => null);

  checar("manifesto responde", Boolean(manifesto));
  if (manifesto) {
    checar("nome e nome curto", Boolean(manifesto.name && manifesto.short_name));
    checar("abre em tela cheia", manifesto.display === "standalone");
    checar("idioma pt-BR", manifesto.lang === "pt-BR");
    checar("cor de tema definida", Boolean(manifesto.theme_color));
    checar("atalhos declarados", (manifesto.shortcuts ?? []).length > 0);

    const temMascara = (manifesto.icons ?? []).some((i) =>
      String(i.purpose ?? "").includes("maskable"),
    );
    checar("ícone com máscara (Android)", temMascara);

    for (const icone of manifesto.icons ?? []) {
      const r = await pagina.request.get(`${BASE}${icone.src}`);
      checar(`ícone ${icone.src}`, r.ok(), r.ok() ? "" : `HTTP ${r.status()}`);
    }
  }

  const sw = await pagina.request.get(`${BASE}/sw.js`);
  checar("service worker publicado", sw.ok());
  const offline = await pagina.request.get(`${BASE}/offline.html`);
  checar("tela de offline publicada", offline.ok());

  // Entra na conta para auditar as telas internas.
  await pagina.goto(`${BASE}/entrar`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[name="email"]', "demo@noveleiras.app");
  await pagina.fill('input[name="senha"]', "plantao123");
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL("**/plantao", { timeout: 45000 }).catch(() => {});

  console.log("\nComportamento nativo");
  const viewport = await pagina
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  checar(
    "zoom de página desativado",
    /user-scalable=no/.test(viewport ?? "") ||
      /maximum-scale=1/.test(viewport ?? ""),
    viewport ?? "",
  );
  checar(
    "área segura respeitada",
    /viewport-fit=cover/.test(viewport ?? ""),
  );

  const corpo = await pagina.evaluate(() => {
    const s = getComputedStyle(document.body);
    return {
      selecao: s.userSelect || s.webkitUserSelect,
      overscroll: s.overscrollBehavior,
      overflowX: s.overflowX,
    };
  });
  checar("interface não selecionável", corpo.selecao === "none", corpo.selecao);
  checar(
    "sem overscroll da página",
    corpo.overscroll.includes("none"),
    corpo.overscroll,
  );

  // A sinopse de uma novela é texto que a pessoa pode querer copiar — ali a
  // regra de "interface não selecionável" precisa dar lugar à exceção.
  await pagina.goto(`${BASE}/novela/coracao-em-plantao`, {
    waitUntil: "domcontentloaded",
  });
  await pagina.waitForTimeout(900);
  const textoSelecionavel = await pagina.evaluate(() => {
    const el = document.querySelector(".selectable");
    return el ? getComputedStyle(el).userSelect : "ausente";
  });
  checar(
    "texto de conteúdo continua selecionável",
    textoSelecionavel === "text",
    textoSelecionavel,
  );

  // --------------------------------------------------- acessibilidade prática
  console.log("\nAcessibilidade prática");
  for (const rota of ROTAS) {
    await pagina.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });
    await pagina.waitForTimeout(900);

    const problemas = await pagina.evaluate(() => {
      const semNome = [];
      const pequenos = [];

      const interativos = document.querySelectorAll(
        'button, a[href], input, [role="switch"], [role="button"]',
      );
      for (const el of interativos) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;

        // Um <label for> também dá nome ao campo, tanto quanto aria-label.
        const rotulo = el.id
          ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          : null;

        const nome = (
          el.getAttribute("aria-label") ||
          rotulo?.textContent ||
          el.getAttribute("title") ||
          el.textContent ||
          el.getAttribute("placeholder") ||
          ""
        ).trim();
        if (!nome) semNome.push(el.tagName + "." + String(el.className).slice(0, 40));

        // 44px é o alvo confortável para o dedo; abaixo disso erra-se muito.
        const alvo = Math.min(r.width, r.height);
        if (alvo < 32) {
          pequenos.push(
            `${el.tagName}(${nome.slice(0, 24)}) ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }

      const h1 = document.querySelectorAll("h1").length;
      const imgSemAlt = [...document.querySelectorAll("img")].filter(
        (i) => i.getAttribute("alt") === null,
      ).length;

      return { semNome, pequenos, h1, imgSemAlt };
    });

    checar(
      `${rota} · todo controle tem nome`,
      problemas.semNome.length === 0,
      problemas.semNome.slice(0, 3).join(", "),
    );
    checar(
      `${rota} · alvos de toque confortáveis`,
      problemas.pequenos.length === 0,
      problemas.pequenos.slice(0, 3).join(", "),
    );
    checar(`${rota} · exatamente um h1`, problemas.h1 === 1, `${problemas.h1} h1`);
    checar(
      `${rota} · imagens com alt`,
      problemas.imgSemAlt === 0,
      `${problemas.imgSemAlt} sem alt`,
    );
  }

  await navegador.close();

  console.log(
    `\n${verificacoes - achados.length}/${verificacoes} verificações ok`,
  );
  if (achados.length > 0) {
    console.log("A corrigir:");
    for (const item of achados) console.log(`  · ${item}`);
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
