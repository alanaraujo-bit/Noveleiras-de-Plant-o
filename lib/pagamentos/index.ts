/**
 * Escolha do provedor de pagamento.
 *
 * Um lugar só decide quem processa dinheiro, e a trava contra o mock em
 * produção mora aqui — não espalhada em cada chamada, onde bastaria esquecer
 * um `if` para vazar.
 *
 * A trava é uma **negativa dupla**: o mock exige que `PAGAMENTOS_MOCK` esteja
 * ligado *e* que o ambiente não seja produção. Uma variável esquecida no
 * painel da Vercel, sozinha, não o destrava — e se alguém tentar, o processo
 * falha alto em vez de silenciosamente liberar conteúdo de graça.
 */

import { MercadoPago, credenciaisPresentes } from "./mercadopago";
import { ProvedorMock } from "./mock";
import type { ProvedorDePagamento } from "./provedor";

export * from "./provedor";
export { MercadoPago } from "./mercadopago";
export { ProvedorMock, SEGREDO_MOCK } from "./mock";

/**
 * O ambiente é produção?
 *
 * `VERCEL_ENV` é a fonte confiável no deploy (`production` só na produção de
 * verdade; preview e development têm valores próprios). `NODE_ENV` cobre
 * execução fora da Vercel — um `next start` numa VM, por exemplo.
 */
export function ehProducao(): boolean {
  const vercel = process.env.VERCEL_ENV;
  if (vercel) return vercel === "production";
  return process.env.NODE_ENV === "production";
}

export function mockPedido(): boolean {
  const v = process.env.PAGAMENTOS_MOCK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "sim";
}

/** O mock pode rodar agora? Só fora de produção e só se pedido. */
export function podeUsarMock(): boolean {
  return mockPedido() && !ehProducao();
}

let cache: ProvedorDePagamento | null = null;

/**
 * O provedor ativo.
 *
 * Ordem de decisão, e o porquê de cada passo:
 *
 * 1. Mock pedido em produção → **erro**. Silenciar isto seria abrir o
 *    catálogo inteiro sem cobrar, e uma configuração errada precisa parar o
 *    deploy, não passar despercebida.
 * 2. Mock pedido fora de produção → mock.
 * 3. Credenciais presentes → Mercado Pago.
 * 4. Nada → Mercado Pago mesmo assim, que falha com `ProvedorNaoConfigurado`
 *    e uma mensagem dizendo qual variável falta. O aplicativo sobe, navega e
 *    compila; só o botão de pagar recusa.
 */
export function provedorDePagamento(): ProvedorDePagamento {
  if (cache) return cache;

  if (mockPedido() && ehProducao()) {
    throw new Error(
      "PAGAMENTOS_MOCK está ligado em produção. O provedor falso libera " +
        "acesso sem cobrança: remova a variável do ambiente de produção.",
    );
  }

  cache = podeUsarMock() ? new ProvedorMock() : new MercadoPago();
  return cache;
}

/** Descarta o provedor memoizado. Só para teste. */
export function esquecerProvedor(): void {
  cache = null;
}

/** Resumo para telas de diagnóstico e para o painel. */
export function estadoDosPagamentos(): {
  provedor: string;
  mock: boolean;
  configurado: boolean;
  producao: boolean;
} {
  const mock = podeUsarMock();
  return {
    provedor: mock ? "mock" : "mercadopago",
    mock,
    configurado: mock || credenciaisPresentes(),
    producao: ehProducao(),
  };
}
