// Verificação local sem criar contas nem alterar progresso no banco.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
await mkdir("capturas/visitante", { recursive: true });
try {
  for (const [nome, viewport] of Object.entries({ mobile: { width: 440, height: 956 }, desktop: { width: 1366, height: 900 } })) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const erros = [];
    page.on("pageerror", (e) => erros.push(e.message));
    await page.goto("http://localhost:3100/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Salvar meu lugar" }).waitFor();
    assert.match(page.url(), /\/plantao/);
    const video = page.locator("video").first();
    await video.waitFor();
    const tocou = await page.waitForFunction(() => [...document.querySelectorAll("video")].some(v => v.currentTime > 0 && v.readyState >= 2), { timeout: 20000 }).then(() => true, () => false);
    console.log(nome, "reprodução real:", tocou);
    await page.screenshot({ path: `capturas/visitante/${nome}-plantao.png` });
    await page.getByRole("button", { name: "Salvar meu lugar" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(400);
    assert.equal(await video.evaluate(v => v.paused), true);
    const cadastro = dialog.getByRole("link", { name: "Criar minha conta grátis" });
    const href = await cadastro.getAttribute("href");
    assert.match(href, /destino=.*episodio/);
    await page.screenshot({ path: `capturas/visitante/${nome}-convite.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Salvar meu lugar" }).click();
    await page.getByRole("link", { name: "Criar minha conta grátis", exact: true }).click();
    await page.getByRole("textbox", { name: "Como podemos te chamar?" }).waitFor();
    assert.match(await page.locator('input[name="destino"]').inputValue(), /plantao\?episodio=/);
    await page.getByRole("link", { name: "Entrar", exact: true }).click();
    await page.getByRole("textbox", { name: "E-mail" }).waitFor();
    assert.match(await page.locator('input[name="destino"]').inputValue(), /plantao\?episodio=/);
    await page.getByRole("button", { name: "Continuar com Google" }).waitFor();
    await page.screenshot({ path: `capturas/visitante/${nome}-login.png` });
    await page.getByRole("link", { name: "Voltar", exact: true }).click();
    await page.getByRole("button", { name: "Salvar meu lugar" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(erros, []);
    console.log(nome, "convite, pausa, dispensa e destino de cadastro/login: OK");
    await context.close();
  }
} finally { await browser.close(); }
