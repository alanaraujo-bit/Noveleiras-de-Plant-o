/**
 * Assinatura de URL de mídia.
 *
 * O problema que resolve: até aqui, a rota validava o direito de assistir e
 * então entregava uma URL permanente do servidor de mídia. Quem copiasse
 * aquela URL uma vez assistia para sempre, e podia repassá-la — o paywall
 * valia para o primeiro pedido e para mais nenhum.
 *
 * Agora a URL carrega prazo e assinatura. O servidor de mídia confere o HMAC
 * antes de abrir o arquivo, e a autorização passa a viver no link em vez de
 * viver só no momento em que ele foi criado.
 *
 * O módulo é puro e sem dependência de framework de propósito: quem o usa são
 * a rota Next (Node) e `scripts/servir-midia.mjs` (processo separado, muitas
 * vezes em outra máquina). Duplicar o algoritmo nos dois lados garantiria que
 * um dia eles divergissem.
 *
 * Migrar para CDN não muda nada disto: `MEDIA_SIGNING_SECRET` vira a chave da
 * CDN e a montagem do manifesto acompanha o formato dela. A regra comercial
 * não é tocada.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Validade padrão de um link. Curta o bastante para não virar link público. */
export const VALIDADE_PADRAO_SEG = 60 * 60 * 4;

export type ParametrosAssinatura = {
  /** Caminho do arquivo na biblioteca, sem barra inicial e sem escapes. */
  caminho: string;
  /** Epoch em segundos. */
  expira: number;
  /** Quem pediu. Amarra o link à conta e deixa rastro em abuso. */
  usuario: string;
};

/**
 * Monta o texto assinado.
 *
 * Separador `\n` porque ele não aparece em nome de arquivo: com `|` ou `:`,
 * um arquivo chamado `a|b` poderia produzir o mesmo manifesto que um caminho
 * diferente com prazo diferente.
 */
function manifesto(p: ParametrosAssinatura): string {
  return `${p.caminho}\n${p.expira}\n${p.usuario}`;
}

export function calcularAssinatura(
  p: ParametrosAssinatura,
  segredo: string,
): string {
  return createHmac("sha256", segredo).update(manifesto(p)).digest("hex");
}

/**
 * Acrescenta prazo e assinatura a uma URL de mídia.
 *
 * Quando não há segredo configurado, devolve a URL intacta — é o modo de
 * desenvolvimento com o servidor de mídia local. O servidor, por sua vez, só
 * exige assinatura quando ele próprio tem segredo: os dois lados destravam
 * juntos, e nenhum deles fica meio protegido.
 */
export function assinarUrl(
  url: string,
  caminho: string,
  usuario: string,
  segredo: string | null,
  validadeSeg: number = VALIDADE_PADRAO_SEG,
): { url: string; expiraEm: Date | null } {
  if (!segredo) return { url, expiraEm: null };

  const expira = Math.floor(Date.now() / 1000) + validadeSeg;
  const assinatura = calcularAssinatura(
    { caminho: normalizar(caminho), expira, usuario },
    segredo,
  );

  const separador = url.includes("?") ? "&" : "?";
  const busca = new URLSearchParams({
    exp: String(expira),
    u: usuario,
    sig: assinatura,
  });

  return {
    url: `${url}${separador}${busca.toString()}`,
    expiraEm: new Date(expira * 1000),
  };
}

export type ResultadoValidacao =
  | { valida: true }
  | { valida: false; motivo: "sem-assinatura" | "expirada" | "invalida" };

/**
 * Confere uma URL assinada. Chamado pelo servidor de mídia.
 *
 * A ordem importa: prazo antes de HMAC. Um link vencido é recusado sem gastar
 * o cálculo, e a mensagem distingue "expirou" de "forjado" — o primeiro é
 * rotina e merece renovação silenciosa, o segundo é sinal de abuso.
 */
export function validarAssinatura(
  caminho: string,
  parametros: {
    exp?: string | null;
    u?: string | null;
    sig?: string | null;
  },
  segredo: string,
  agoraSeg: number = Math.floor(Date.now() / 1000),
): ResultadoValidacao {
  const { exp, u, sig } = parametros;
  if (!exp || !u || !sig) return { valida: false, motivo: "sem-assinatura" };

  const expira = Number(exp);
  if (!Number.isFinite(expira)) return { valida: false, motivo: "invalida" };
  if (expira < agoraSeg) return { valida: false, motivo: "expirada" };

  const esperada = calcularAssinatura(
    { caminho: normalizar(caminho), expira, usuario: u },
    segredo,
  );

  return comparaSegura(esperada, sig)
    ? { valida: true }
    : { valida: false, motivo: "invalida" };
}

/**
 * Normaliza o caminho antes de assinar ou conferir.
 *
 * Os dois lados veem a mesma string por caminhos diferentes: aqui ela vem do
 * banco (`A Sem-Pelo/E01.mp4`), lá ela vem da URL, percent-encoded. Sem
 * normalizar, toda mídia com espaço ou acento no nome — que é a maioria —
 * falharia na conferência.
 */
export function normalizar(caminho: string): string {
  let bruto = caminho;
  try {
    bruto = decodeURIComponent(caminho);
  } catch {
    // Percentagem malformada: usa o literal, e a conferência decide.
  }
  return bruto.replace(/^\/+/, "");
}

export function segredoDeMidia(): string | null {
  return process.env.MEDIA_SIGNING_SECRET?.trim() || null;
}

function comparaSegura(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}
