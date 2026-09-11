/**
 * Leitura de uma notificação do Mercado Pago, antes de confiar em qualquer
 * coisa.
 *
 * O Mercado Pago entrega por dois canais, e eles não são o mesmo contrato:
 *
 *   WEBHOOK  corpo `{ id, type, action, data: { id }, live_mode, ... }`,
 *            assinado com `x-signature` + `x-request-id`. É o único canal que
 *            processamos.
 *
 *   IPN      o canal legado: `?topic=…&id=…` na URL, ou corpo
 *            `{ topic, resource }` — onde `resource` pode ser um id puro ou
 *            uma URL inteira (`https://api.mercadolibre.com/merchant_orders/…`).
 *            Não tem a assinatura do Webhook, então conferir HMAC nele só
 *            produz um falso "forjado". Preapprovals e preferências criadas
 *            antes de `source_news=webhooks` continuam mandando IPN.
 *
 * Os dois formatos reais estão gravados em produção (`WebhookEvent`, 10/09):
 * foi a mistura deles no mesmo caminho que fez IPN legítimo aparecer como
 * assinatura inválida.
 *
 * Mercado Pago e mock usam esta mesma leitura, mudando só o segredo — se a
 * montagem do manifesto estiver errada, o modo mock quebra junto.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  DiagnosticoNotificacao,
  OrigemDoDataId,
  WebhookLido,
} from "./provedor";

type Corpo = Record<string, unknown>;

function lerCorpo(corpoCru: string): Corpo {
  try {
    const lido = corpoCru ? (JSON.parse(corpoCru) as unknown) : {};
    return lido && typeof lido === "object" && !Array.isArray(lido)
      ? (lido as Corpo)
      : { corpoInvalido: corpoCru.slice(0, 500) };
  } catch {
    return { corpoInvalido: corpoCru.slice(0, 500) };
  }
}

function texto(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * IPN é reconhecido pela **forma**, não pelo nome do tópico: `topic` ou
 * `resource` sem o envelope moderno. Qualquer coisa que não seja claramente
 * IPN vai para o caminho do Webhook — e lá, sem assinatura, é recusada. Na
 * dúvida, exigir assinatura é o lado seguro.
 */
export function ehIpnLegado(corpo: Corpo, url: URL): boolean {
  const temEnvelopeModerno =
    typeof corpo.type === "string" ||
    (corpo.data !== null && typeof corpo.data === "object");
  if (temEnvelopeModerno) return false;

  if (typeof corpo.topic === "string" || corpo.resource !== undefined) {
    return true;
  }
  // Corpo vazio ou ilegível: decide a URL.
  return url.searchParams.has("topic") && !url.searchParams.has("type");
}

/** O último segmento de `resource`, que pode vir como URL inteira. */
function idDoRecurso(resource: unknown): string | null {
  const bruto = texto(resource);
  if (!bruto) return null;
  const ultimo = bruto.split(/[/?#]/).filter(Boolean).pop() ?? bruto;
  return ultimo;
}

function comparaSegura(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function lerNotificacao(
  corpoCru: string,
  cabecalhos: Headers,
  url: URL,
  segredo: string,
): WebhookLido {
  const payload = lerCorpo(corpoCru);
  const liveMode =
    typeof payload.live_mode === "boolean" ? payload.live_mode : null;

  const assinatura = cabecalhos.get("x-signature");
  const requestId = cabecalhos.get("x-request-id");

  const partes = new Map(
    (assinatura ?? "").split(",").map((p) => {
      const [k, ...v] = p.split("=");
      return [k.trim(), v.join("=").trim()] as const;
    }),
  );
  const ts = partes.get("ts") ?? "";
  const v1 = partes.get("v1") ?? "";

  // Só presença e forma. O valor de `x-signature`, o `v1` e o segredo nunca
  // saem daqui.
  const base = {
    hasXSignature: assinatura !== null,
    hasXRequestId: requestId !== null,
    signatureHasTs: ts !== "",
    signatureHasV1: v1 !== "",
    liveMode,
  };

  if (ehIpnLegado(payload, url)) {
    const topico =
      texto(payload.topic) ?? url.searchParams.get("topic") ?? "desconhecido";
    const recursoId =
      url.searchParams.get("id") ?? idDoRecurso(payload.resource);

    const diagnostico: DiagnosticoNotificacao = {
      formato: "IPN",
      ...base,
      dataIdSource: url.searchParams.has("id") ? "query-id" : null,
    };

    return {
      formato: "IPN",
      // Não conferida — IPN não traz a assinatura do Webhook. `false` aqui
      // quer dizer "não validada", e o receptor nunca processa IPN.
      assinaturaValida: false,
      eventId: `${topico}:${recursoId ?? "sem-id"}`,
      topico,
      acao: null,
      recursoId,
      payload,
      diagnostico,
    };
  }

  // O `data.id` sai de preferência da query string: o corpo pode ser
  // reserializado por qualquer proxy no caminho. A origem registrada é o ramo
  // que de fato foi usado.
  const idDoCorpo = texto((payload.data as { id?: unknown } | undefined)?.id);
  let dataId: string | null = null;
  let dataIdSource: OrigemDoDataId | null = null;
  if (url.searchParams.get("data.id") !== null) {
    dataId = url.searchParams.get("data.id");
    dataIdSource = "query-data.id";
  } else if (url.searchParams.get("id") !== null) {
    dataId = url.searchParams.get("id");
    dataIdSource = "query-id";
  } else if (idDoCorpo !== null) {
    dataId = idDoCorpo;
    dataIdSource = "body-data.id";
  }

  // Eles normalizam ids alfanuméricos para minúsculas antes de assinar.
  const manifesto =
    `id:${dataId ? dataId.toLowerCase() : ""};` +
    `request-id:${requestId ?? ""};ts:${ts};`;
  const esperado = createHmac("sha256", segredo).update(manifesto).digest("hex");

  // Sem os dois cabeçalhos não há o que conferir: recusar direto, em vez de
  // montar um manifesto com campos vazios.
  const assinaturaValida =
    base.hasXSignature && base.hasXRequestId && comparaSegura(esperado, v1);

  const topico =
    texto(payload.type) ?? url.searchParams.get("type") ?? "desconhecido";
  const acao = typeof payload.action === "string" ? payload.action : null;

  return {
    formato: "WEBHOOK",
    assinaturaValida,
    // O `id` do envelope é o do evento; quando falta, o par recurso+ação é
    // estável o bastante para barrar reentrega da mesma notificação.
    eventId:
      texto(payload.id) ?? `${topico}:${acao ?? "sem-acao"}:${dataId ?? "sem-id"}`,
    topico,
    acao,
    recursoId: dataId,
    payload,
    diagnostico: { formato: "WEBHOOK", ...base, dataIdSource },
  };
}
