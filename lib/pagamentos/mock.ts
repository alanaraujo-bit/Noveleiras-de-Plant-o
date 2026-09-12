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
  type CriarCobrancaPixEntrada,
  type CriarCompraEntrada,
  type EstadoProvedor,
  type FaturaDeAssinatura,
  type ProvedorDePagamento,
  type ResolucaoDePreferencia,
  type RespostaCheckout,
  type ResultadoReembolso,
  type WebhookLido,
} from "./provedor";
import { lerNotificacao } from "./notificacao";

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

  /**
   * Um ciclo mensal por Pix. Nasce como pagamento, não como preapproval —
   * `assinatura: false` é o ponto: a reconciliação precisa achá-lo por
   * `consultarPagamento`, como acha qualquer cobrança avulsa.
   */
  async criarAssinaturaPix(
    entrada: CriarCobrancaPixEntrada,
  ): Promise<RespostaCheckout> {
    const externalId = `mock-pix-${randomUUID()}`;
    const status = decidirPorEmail(entrada.usuario.email);

    registros.set(externalId, {
      externalId,
      status,
      valorCents: entrada.plano.precoCents,
      referenciaExterna: entrada.referenciaExterna,
      metodo: "pix",
      aprovadoEm: status === "APPROVED" ? new Date() : null,
      reembolsadoCents: 0,
      assinatura: false,
    });

    return {
      externalId,
      status,
      checkoutUrl: null,
      pixQrCode: `00020126MOCK${externalId}5204000053039865802BR`,
      pixQrCodeBase64: null,
      expiraEm: new Date(Date.now() + entrada.expiraEmMinutos * 60_000),
      bruto: { mock: true, tipo: "pix-mensal", externalId, status },
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
      preapprovalId: r.assinatura ? r.externalId : null,
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
      statusCru: r.status === "APPROVED" ? "authorized" : r.status.toLowerCase(),
      referenciaExterna: r.referenciaExterna,
      proximaCobranca: null,
      cobrancasRealizadas: r.status === "APPROVED" ? 1 : 0,
      bruto: r,
    };
  }

  /**
   * Uma fatura por assinatura, e a cobrança dela é o próprio registro: o
   * provedor falso não tem retentativa nem ciclo seguinte. Basta para que o
   * livro de ciclos funcione de ponta a ponta sem credencial.
   */
  async listarFaturas(preapprovalId: string): Promise<FaturaDeAssinatura[]> {
    const fatura = await this.consultarFatura(`fat-${preapprovalId}`);
    return fatura ? [fatura] : [];
  }

  async consultarFatura(faturaId: string): Promise<FaturaDeAssinatura | null> {
    const preapprovalId = faturaId.replace(/^fat-/, "");
    const r = registros.get(preapprovalId);
    if (!r || !r.assinatura) return null;

    return {
      id: faturaId,
      preapprovalId,
      statusCru: "processed",
      referenciaExterna: r.referenciaExterna,
      dataDebito: r.aprovadoEm,
      valorCents: r.valorCents,
      moeda: "BRL",
      metodo: r.metodo,
      retentativa: 1,
      pagamento:
        r.status === "PENDING"
          ? null
          : {
              id: preapprovalId,
              status: r.status,
              statusCru: r.status.toLowerCase(),
              detalheCru: null,
            },
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
   * Mesma leitura do Mercado Pago (`notificacao.ts`), só com o segredo fixo:
   * se a montagem do manifesto ou a separação Webhook/IPN estiver errada, o
   * modo mock quebra junto — e não passamos meses achando que a validação
   * funciona.
   */
  async lerWebhook(
    corpoCru: string,
    cabecalhos: Headers,
    url: URL,
  ): Promise<WebhookLido> {
    return lerNotificacao(corpoCru, cabecalhos, url, SEGREDO_MOCK);
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
