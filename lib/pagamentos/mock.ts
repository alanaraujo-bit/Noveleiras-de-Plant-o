/**
 * Provedor falso, para desenvolvimento e teste.
 *
 * Existe para que a fase comercial inteira — assinatura, compra avulsa,
 * recusa, expiração, cancelamento, webhook duplicado, reembolso e chargeback
 * — seja exercitável de ponta a ponta antes de qualquer credencial existir.
 *
 * **Como ele nunca liga em produção:** a trava está em `podeUsarMock()`, em
 * `index.ts`, e é uma negativa dupla — precisa que `PAGAMENTOS_MOCK` esteja
 * ligado *e* que o ambiente não seja produção. Uma variável esquecida no
 * painel da Vercel não basta para destravar.
 *
 * O comportamento é determinístico, escolhido pelo e-mail de quem paga, para
 * que um teste automatizado peça "cartão recusado" sem depender de sorte:
 *
 *   recusa@…    → REJECTED
 *   pendente@…  → PENDING (fica esperando o webhook)
 *   qualquer…   → APPROVED
 */

import { randomUUID } from "node:crypto";

import {
  type ConsultaAssinatura,
  type ConsultaPagamento,
  type CriarAssinaturaEntrada,
  type CriarCompraEntrada,
  type EstadoProvedor,
  type ProvedorDePagamento,
  type ResolucaoDePreferencia,
  type RespostaCheckout,
  type ResultadoReembolso,
  type WebhookLido,
} from "./provedor";

/** Segredo do webhook no modo mock. Fixo e público de propósito. */
export const SEGREDO_MOCK = "mock-webhook-secret";

type Registro = {
  externalId: string;
  status: EstadoProvedor;
  valorCents: number;
  referenciaExterna: string;
  metodo: string;
  aprovadoEm: Date | null;
  reembolsadoCents: number;
  assinatura: boolean;
};

/**
 * Memória do provedor falso.
 *
 * Em módulo, e não em banco, porque isto imita o *lado de lá* — o Mercado
 * Pago não mora no nosso Postgres. Some a cada reinício, que é o desejado:
 * teste não deve herdar estado de execução anterior.
 */
const registros = new Map<string, Registro>();

function decidirPorEmail(email: string): EstadoProvedor {
  const e = email.toLowerCase();
  if (e.startsWith("recusa@") || e.includes("+recusa")) return "REJECTED";
  if (e.startsWith("pendente@") || e.includes("+pendente")) return "PENDING";
  return "APPROVED";
}

export class ProvedorMock implements ProvedorDePagamento {
  readonly nome = "mock";
  readonly configurado = true;

  async criarAssinatura(
    entrada: CriarAssinaturaEntrada,
  ): Promise<RespostaCheckout> {
    const externalId = `mock-sub-${randomUUID()}`;
    const status = decidirPorEmail(entrada.usuario.email);

    registros.set(externalId, {
      externalId,
      status,
      valorCents: entrada.plano.precoCents,
      referenciaExterna: entrada.referenciaExterna,
      metodo: entrada.metodo === "PIX" ? "pix" : "credit_card",
      aprovadoEm: status === "APPROVED" ? new Date() : null,
      reembolsadoCents: 0,
      assinatura: true,
    });

    return {
      externalId,
      status,
      // Tela interna que imita o checkout do provedor sem sair do aplicativo.
      checkoutUrl: `/pagamento/simulado?ref=${encodeURIComponent(externalId)}`,
      pixQrCode: null,
      pixQrCodeBase64: null,
      expiraEm: null,
      bruto: { mock: true, tipo: "preapproval", externalId, status },
    };
  }

  async criarCompra(entrada: CriarCompraEntrada): Promise<RespostaCheckout> {
    const externalId = `mock-pay-${randomUUID()}`;
    const status = decidirPorEmail(entrada.usuario.email);
    const pix = entrada.metodo === "PIX";

    registros.set(externalId, {
      externalId,
      status,
      valorCents: entrada.valorCents,
      referenciaExterna: entrada.referenciaExterna,
      metodo: pix ? "pix" : "credit_card",
      aprovadoEm: status === "APPROVED" ? new Date() : null,
      reembolsadoCents: 0,
      assinatura: false,
    });

    return {
      externalId,
      status,
      checkoutUrl: `/pagamento/simulado?ref=${encodeURIComponent(externalId)}`,
      pixQrCode: pix ? `00020126MOCK${externalId}5204000053039865802BR` : null,
      pixQrCodeBase64: null,
      expiraEm: pix ? new Date(Date.now() + 30 * 60_000) : null,
      bruto: { mock: true, tipo: "payment", externalId, status },
    };
  }

  /**
   * O mock cria o pagamento direto, sem preferência intermediária: não há
   * redirecionamento para tela nenhuma de terceiro. Devolver a própria
   * referência mantém o contrato sem inventar um objeto que não existe aqui.
   */
  async resolverPreferencia(
    preferenceId: string,
  ): Promise<ResolucaoDePreferencia | null> {
    if (!registros.has(preferenceId)) return null;
    return { merchantOrderId: null, pagamentoIds: [preferenceId] };
  }

  async pagamentosDaMerchantOrder(merchantOrderId: string): Promise<string[]> {
    return registros.has(merchantOrderId) ? [merchantOrderId] : [];
  }

  async consultarPagamento(
    externalId: string,
  ): Promise<ConsultaPagamento | null> {
    const r = registros.get(externalId);
    if (!r) return null;

    return {
      externalId: r.externalId,
      status: r.status,
      valorCents: r.valorCents,
      moeda: "BRL",
      metodo: r.metodo,
      referenciaExterna: r.referenciaExterna,
      aprovadoEm: r.aprovadoEm,
      reembolsadoCents: r.reembolsadoCents,
      statusCru: r.status.toLowerCase(),
      detalheCru: r.status === "REJECTED" ? "cc_rejected_other_reason" : null,
      bruto: r,
    };
  }

  async consultarAssinatura(
    externalId: string,
  ): Promise<ConsultaAssinatura | null> {
    const r = registros.get(externalId);
    if (!r) return null;

    return {
      externalId: r.externalId,
      status: r.status,
      referenciaExterna: r.referenciaExterna,
      proximaCobranca: null,
      bruto: r,
    };
  }

  async cancelarAssinatura(externalId: string): Promise<EstadoProvedor> {
    const r = registros.get(externalId);
    if (!r) throw new Error("assinatura inexistente no provedor falso");
    registros.set(externalId, { ...r, status: "CANCELED" });
    return "CANCELED";
  }

  async reembolsar(
    externalId: string,
    valorCents?: number,
  ): Promise<ResultadoReembolso> {
    const r = registros.get(externalId);
    if (!r) {
      return {
        externalId: null,
        status: "UNKNOWN",
        valorCents: 0,
        bruto: { mock: true, erro: "pagamento inexistente" },
      };
    }

    const valor = valorCents ?? r.valorCents - r.reembolsadoCents;
    const reembolsado = r.reembolsadoCents + valor;

    registros.set(externalId, {
      ...r,
      reembolsadoCents: reembolsado,
      status: reembolsado >= r.valorCents ? "REFUNDED" : r.status,
    });

    return {
      externalId: `mock-refund-${randomUUID()}`,
      status: "REFUNDED",
      valorCents: valor,
      bruto: { mock: true, externalId, valor },
    };
  }

  /**
   * Valida o webhook do mock com o mesmo algoritmo do Mercado Pago.
   *
   * Reimplementar aqui em vez de aceitar qualquer coisa é o que faz o teste
   * ter valor: se a montagem do manifesto estiver errada, o modo mock quebra
   * junto — e não passamos meses achando que a validação funciona.
   */
  async lerWebhook(
    corpoCru: string,
    cabecalhos: Headers,
    url: URL,
  ): Promise<WebhookLido> {
    const { createHmac, timingSafeEqual } = await import("node:crypto");

    let payload: Record<string, unknown> = {};
    try {
      payload = corpoCru ? (JSON.parse(corpoCru) as Record<string, unknown>) : {};
    } catch {
      payload = { corpoInvalido: corpoCru.slice(0, 500) };
    }

    const partes = new Map(
      (cabecalhos.get("x-signature") ?? "").split(",").map((p) => {
        const [k, ...v] = p.split("=");
        return [k.trim(), v.join("=").trim()] as const;
      }),
    );

    const dataId =
      url.searchParams.get("data.id") ??
      ((payload.data as { id?: unknown } | undefined)?.id !== undefined
        ? String((payload.data as { id: unknown }).id)
        : null);

    const manifesto =
      `id:${dataId ? dataId.toLowerCase() : ""};` +
      `request-id:${cabecalhos.get("x-request-id") ?? ""};` +
      `ts:${partes.get("ts") ?? ""};`;

    const esperado = createHmac("sha256", SEGREDO_MOCK)
      .update(manifesto)
      .digest("hex");
    const recebido = partes.get("v1") ?? "";

    let valida = false;
    if (esperado.length === recebido.length && recebido.length > 0) {
      try {
        valida = timingSafeEqual(
          Buffer.from(esperado, "utf8"),
          Buffer.from(recebido, "utf8"),
        );
      } catch {
        valida = false;
      }
    }

    const topico =
      (typeof payload.type === "string" && payload.type) ||
      url.searchParams.get("type") ||
      "payment";

    return {
      assinaturaValida: valida,
      eventId:
        payload.id !== undefined && payload.id !== null
          ? String(payload.id)
          : `${topico}:${dataId ?? "sem-id"}`,
      topico,
      acao: typeof payload.action === "string" ? payload.action : null,
      recursoId: dataId,
      payload,
    };
  }

  // ------------------------------------------------ auxiliares só de teste

  /** Força um estado, para exercitar recusa, reembolso e chargeback. */
  static definirStatus(externalId: string, status: EstadoProvedor): void {
    const r = registros.get(externalId);
    if (r) {
      registros.set(externalId, {
        ...r,
        status,
        aprovadoEm: status === "APPROVED" ? (r.aprovadoEm ?? new Date()) : r.aprovadoEm,
      });
    }
  }

  static limpar(): void {
    registros.clear();
  }
}
