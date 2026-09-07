/**
 * Percorre o fluxo principal ponta a ponta num viewport de celular:
 * entrar → Home → novela → player → progresso gravado → volta.
 *
 * Complementa `inspecionar.mjs`, que só olha telas paradas. Ferramenta de
 * desenvolvimento; não faz parte do produto.
 *
 * Uso: node scripts/fluxo.mjs [--base=http://localhost:3100] [--saida=dir]
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const arg = (nome, padrao) => {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
};

const BASE = arg("base", "http://localhost:3100");
// Produção pode ter partida a frio: um limite curto acusaria falha onde só
// houve a primeira requisição da função.
const ESPERA = Number(arg("espera", 45000));
const SAIDA = arg("saida", "capturas/fluxo");

const problemas = [];
const passos = [];

function passo(nome, ok, detalhe = "") {
  passos.push({ nome, ok, detalhe });
  console.log(`${ok ? "  ok " : " FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) problemas.push(nome);
}

async function main() {
  await mkdir(SAIDA, { recursive: true });
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // O autoplay precisa de permissão explícita fora de um gesto do usuário.
    permissions: [],
  });

  const pagina = await contexto.newPage();
  pagina.on("pageerror", (erro) => problemas.push(`pageerror: ${erro.message}`));
  pagina.on("console", (msg) => {
    if (msg.type() === "error") problemas.push(`console: ${msg.text()}`);
  });

  const captura = (nome) => pagina.screenshot({ path: join(SAIDA, `${nome}.png`) });

  // 1. Entrar --------------------------------------------------------------
  await pagina.goto(`${BASE}/entrar`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[name="email"]', "demo@noveleiras.app");
  await pagina.fill('input[name="senha"]', "plantao123");
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL("**/inicio", { timeout: ESPERA }).catch(() => {});
  passo("entrar na conta", new URL(pagina.url()).pathname === "/inicio");

  // 2. Home carrega com conteúdo -------------------------------------------
  await pagina.waitForSelector("text=Continuar assistindo", { timeout: ESPERA });
  const capas = await pagina.locator('a[href^="/novela/"]').count();
  passo("home lista novelas", capas > 4, `${capas} atalhos`);
  await captura("1-home");

  // 3. Abrir uma novela -----------------------------------------------------
  await pagina.goto(`${BASE}/novela/coracao-em-plantao`, {
    waitUntil: "domcontentloaded",
  });
  await pagina.waitForSelector("h1", { timeout: ESPERA });
  const titulo = await pagina.locator("h1").first().innerText();
  passo("abrir novela", titulo.includes("Coração"), titulo);
  await captura("2-novela");

  // 4. Botão principal leva ao player ---------------------------------------
  const principal = pagina.locator('a[href^="/assistir/"]').first();
  await principal.click();
  await pagina.waitForURL("**/assistir/**", { timeout: ESPERA });
  passo("abrir o player", pagina.url().includes("/assistir/"));

  // 5. Vídeo carrega e toca -------------------------------------------------
  await pagina.waitForSelector("video", { timeout: ESPERA });
  const video = pagina.locator("video");
  await pagina
    .waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2;
      },
      { timeout: ESPERA },
    )
    .catch(() => {});

  const metadados = await video.evaluate((v) => ({
    duracao: v.duration,
    largura: v.videoWidth,
    prontidao: v.readyState,
    src: v.currentSrc,
  }));
  passo(
    "vídeo carregou",
    metadados.prontidao >= 2 && metadados.largura > 0,
    `${Math.round(metadados.duracao)}s · ${metadados.largura}px`,
  );

  // Autoplay pode ser barrado sem som; damos o gesto que o navegador espera.
  await video.evaluate((v) => {
    v.muted = true;
    return v.play();
  });
  await pagina.waitForTimeout(3500);

  const tocou = await video.evaluate((v) => ({
    tempo: v.currentTime,
    pausado: v.paused,
  }));
  passo("vídeo tocou", tocou.tempo > 0.5, `${tocou.tempo.toFixed(1)}s`);
  await captura("3-player");

  // 6. Avançar e confirmar que o controle responde --------------------------
  await video.evaluate((v) => {
    v.currentTime = 40;
  });
  await pagina.waitForTimeout(2500);
  const depoisDoSalto = await video.evaluate((v) => v.currentTime);
  passo("buscar no tempo", depoisDoSalto > 39, `${depoisDoSalto.toFixed(1)}s`);

  // 7. Progresso persistido -------------------------------------------------
  const episodeId = pagina.url().split("/assistir/")[1];
  await pagina.goto(`${BASE}/perfil/historico`, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(1200);
  const historico = await pagina.locator(`a[href="/assistir/${episodeId}"]`).count();
  passo("progresso no histórico", historico > 0);
  await captura("4-historico");

  // 8. Retomada -------------------------------------------------------------
  await pagina.goto(`${BASE}/assistir/${episodeId}`, {
    waitUntil: "domcontentloaded",
  });
  await pagina.waitForSelector("video", { timeout: ESPERA });
  await pagina
    .waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.currentTime > 30;
      },
      { timeout: ESPERA },
    )
    .catch(() => {});
  const retomou = await pagina.locator("video").evaluate((v) => v.currentTime);
  passo("retomar de onde parou", retomou > 30, `${retomou.toFixed(1)}s`);

  // 9. Paywall de episódio premium para conta gratuita ----------------------
  const gratuito = await navegador.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    locale: "pt-BR",
  });
  const anonima = await gratuito.newPage();
  const resposta = await anonima.goto(`${BASE}/api/midia/${episodeId}`);
  passo(
    "mídia exige sessão",
    resposta?.status() === 401,
    `HTTP ${resposta?.status()}`,
  );
  await gratuito.close();

  // 10. Busca ----------------------------------------------------------------
  await pagina.goto(`${BASE}/buscar`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[type="search"]', "coracao");
  await pagina.waitForTimeout(1500);
  const achados = await pagina.locator('a[href^="/novela/"]').count();
  passo("busca sem acento encontra", achados > 0, `${achados} resultados`);
  await captura("5-busca");

  await navegador.close();

  const falhas = passos.filter((p) => !p.ok).length;
  console.log(`\n${passos.length - falhas}/${passos.length} passos ok`);
  if (problemas.length > 0) {
    console.log("Problemas:");
    for (const item of [...new Set(problemas)]) console.log(`  · ${item}`);
  }
  if (falhas > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
