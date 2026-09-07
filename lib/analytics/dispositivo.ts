/**
 * Leitura de dispositivo a partir do User-Agent.
 *
 * Por que existe: a sessão nascia no login com `deviceId: "pendente"` e sem
 * sistema nem navegador, contando com o cliente para preencher depois. Quando
 * a pessoa fecha a aba antes disso — ou quando o pedido vem de um fluxo sem
 * JavaScript — a sessão fica cega, e o painel mostra um buraco em vez de um
 * dispositivo. Hoje isso é 18% das sessões gravadas.
 *
 * O cliente continua sendo a fonte melhor (sabe tela, fuso, idioma e se está
 * instalado); isto é o piso, para que nenhuma sessão nasça sem nada.
 *
 * Deliberadamente simples: reconhecer as famílias que aparecem no produto vale
 * mais que uma biblioteca de detecção com centenas de regras.
 */

export type LeituraDeDispositivo = {
  osName: string | null;
  browser: string | null;
  /** "web" | "pwa" — o servidor só consegue afirmar "web". */
  platform: string;
};

export function lerDispositivo(userAgent: string | null | undefined): LeituraDeDispositivo {
  if (!userAgent) return { osName: null, browser: null, platform: "web" };
  const ua = userAgent;

  const osName =
    /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows NT/i.test(ua)
          ? "Windows"
          : /Mac OS X/i.test(ua)
            ? "macOS"
            : /CrOS/i.test(ua)
              ? "ChromeOS"
              : /Linux/i.test(ua)
                ? "Linux"
                : null;

  // A ordem importa: quase todo navegador mente dizendo ser Safari e Chrome.
  const browser =
    /Edg\//i.test(ua)
      ? "Edge"
      : /OPR\/|Opera/i.test(ua)
        ? "Opera"
        : /SamsungBrowser/i.test(ua)
          ? "Samsung Internet"
          : /Firefox\/|FxiOS/i.test(ua)
            ? "Firefox"
            : /CriOS/i.test(ua)
              ? "Chrome"
              : /Chrome\//i.test(ua)
                ? "Chrome"
                : /Safari\//i.test(ua)
                  ? "Safari"
                  : /HeadlessChrome|Playwright|bot|crawler|spider/i.test(ua)
                    ? "Automação"
                    : null;

  return { osName, browser, platform: "web" };
}

/** Rótulo curto para tabelas: "iOS · Safari". */
export function rotuloDeDispositivo(
  osName: string | null,
  browser: string | null,
): string {
  if (!osName && !browser) return "Não informado";
  if (!browser) return osName ?? "Não informado";
  if (!osName) return browser;
  return `${osName} · ${browser}`;
}
