/**
 * Camada de mídia.
 *
 * Nenhuma parte do produto conhece a URL de um vídeo. O banco guarda apenas
 * uma chave opaca (`mediaKey`) e o provedor. Este módulo é o único lugar que
 * transforma isso em algo tocável. Migrar do computador de casa para uma CDN
 * é trocar MEDIA_PROVIDER/MEDIA_BASE_URL — nada mais no app muda.
 */

export type MediaProviderName =
  | "LOCAL"
  | "RAILWAY"
  | "OBJECT_STORE"
  | "CDN"
  | "EXTERNAL";

export type MediaKind = "mp4" | "hls";

export type MediaTrack = {
  kind: "subtitles" | "captions";
  label: string;
  lang: string;
  src: string;
};

/** Descritor que o player consome. Nunca uma string solta. */
export type MediaSource = {
  kind: MediaKind;
  url: string;
  poster: string | null;
  tracks: MediaTrack[];
  /** Segundos; 0 quando desconhecido. */
  durationSec: number;
  provider: MediaProviderName;
  /** Presente quando a URL expira — o cliente sabe que precisa renovar. */
  expiresAt: string | null;
};

export type ResolveInput = {
  mediaKey: string;
  provider?: MediaProviderName | null;
  format?: string | null;
  thumbKey?: string | null;
  durationSec?: number | null;
};

const DEFAULT_PROVIDER = (process.env.MEDIA_PROVIDER ??
  "LOCAL") as MediaProviderName;

function baseUrlFor(provider: MediaProviderName): string {
  const configured = process.env.MEDIA_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Padrões sensatos por provedor, para que a ausência de configuração
  // não derrube o app em desenvolvimento.
  switch (provider) {
    case "LOCAL":
      return "/media";
    default:
      return "/media";
  }
}

/**
 * Junta base e chave, codificando cada segmento.
 *
 * A codificação é por segmento, não sobre a chave inteira: `encodeURIComponent`
 * na chave toda transformaria as barras em `%2F` e destruiria o caminho.
 *
 * Isso nunca apareceu enquanto as chaves vinham do seed (`demo/slug/s1e1.mp4`,
 * tudo minúsculo e sem espaço). Uma biblioteca de verdade tem "A Filha Secreta
 * do CEO - E01.mp4", e uma URL com espaço cru só funciona porque o navegador
 * conserta — o que não vale para `fetch`, para o servidor de mídia nem para um
 * cliente que não seja navegador.
 *
 * Um segmento já codificado é preservado: decodificar antes evita transformar
 * `%20` em `%2520` a cada passagem.
 */
function joinKey(base: string, key: string): string {
  const clean = key.replace(/^\/+/, "");
  const encoded = clean
    .split("/")
    .map((segmento) => {
      let cru = segmento;
      try {
        cru = decodeURIComponent(segmento);
      } catch {
        // Percentagem malformada: trata como texto literal.
      }
      return encodeURIComponent(cru);
    })
    .join("/");
  return `${base}/${encoded}`;
}

/**
 * Resolve a chave em uma fonte tocável.
 *
 * Ponto de extensão futuro: para OBJECT_STORE/CDN, assinar a URL aqui e
 * preencher `expiresAt`. A assinatura pertence a este módulo — jamais à UI.
 */
export function resolveMedia(input: ResolveInput): MediaSource {
  const provider = (input.provider ?? DEFAULT_PROVIDER) as MediaProviderName;
  const base = baseUrlFor(provider);
  const format = (input.format ?? "mp4").toLowerCase();
  const kind: MediaKind = format === "hls" || format === "m3u8" ? "hls" : "mp4";

  const isAbsolute = /^https?:\/\//i.test(input.mediaKey);
  const url = isAbsolute ? input.mediaKey : joinKey(base, input.mediaKey);

  return {
    kind,
    url,
    poster: input.thumbKey ? posterUrl(input.thumbKey) : null,
    tracks: [],
    durationSec: input.durationSec ?? 0,
    provider,
    expiresAt: null,
  };
}

/**
 * Arte (capas, thumbs, heróis). Enquanto não há arte real, chaves que começam
 * com "gen:" são desenhadas pelo próprio app — o que mantém o catálogo bonito
 * sem depender de arquivos, e a troca por arte real é só trocar a chave.
 */
export function posterUrl(key: string): string {
  if (/^https?:\/\//i.test(key)) return key;
  if (key.startsWith("gen:")) return `/api/arte/${key.slice(4)}`;
  return joinKey(baseUrlFor(DEFAULT_PROVIDER), key);
}

export function isGeneratedArt(key: string): boolean {
  return key.startsWith("gen:");
}
