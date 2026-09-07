/**
 * Para onde voltar depois de entrar.
 *
 * Um destino vindo da URL é entrada de terceiro: se aceito cru, vira um redirect
 * aberto — alguém manda `/entrar?destino=https://site-falso` e o nosso login
 * despeja a pessoa lá, com a nossa marca dando credibilidade ao golpe.
 *
 * Só passa caminho interno absoluto. `//outro.site` é recusado de propósito: o
 * navegador o trata como URL com protocolo relativo, não como caminho.
 */
export function destinoSeguro(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo.startsWith("/")) return null;
  if (limpo.startsWith("//")) return null;
  if (limpo.includes("\\")) return null;
  if (limpo.length > 512) return null;
  return limpo;
}
