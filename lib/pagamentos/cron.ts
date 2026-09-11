import { expirarDireitosVencidos } from "@/lib/access/direitos";
import { log } from "@/lib/painel/log";

import {
  expirarAssinaturasVencidas,
  reconciliarAssinaturasPeriodicamente,
  type ResumoDaReconciliacao,
} from "./servico";

/**
 * `ASSINATURAS_RECONCILIAR` ligada?
 *
 * Aceita as mesmas grafias de `PAGAMENTOS_MOCK` (`1`, `true`, `sim`). A
 * primeira versão só aceitava `"1"`, e configurar `true` — o valor que
 * qualquer um escreveria — deixava a reconciliação desligada sem aviso.
 */
export function reconciliacaoLigada(): boolean {
  const v = process.env.ASSINATURAS_RECONCILIAR?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "sim";
}

/**
 * Sem `CRON_SECRET` a rota se recusa a rodar, em vez de ficar aberta para
 * qualquer um disparar. A Vercel envia o segredo sozinha nas execuções do
 * cron — agendadas e as disparadas por `vercel crons run`.
 */
export function cronAutorizado(requisicao: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  return requisicao.headers.get("authorization") === `Bearer ${segredo}`;
}

export type ResultadoDoCron = {
  reconciliacao: ResumoDaReconciliacao | "desligada";
  assinaturas: number;
  direitos: number;
};

/**
 * O cron de assinaturas, nesta ordem, e a ordem é o ponto:
 *
 * 1. **Mercado Pago → reconciliar.** Quem pagou a renovação mas cujo webhook
 *    não chegou precisa ser descoberto como pagante ANTES de…
 * 2. **…expirar.** Na ordem inversa, o cron cortaria primeiro e descobriria o
 *    pagamento depois.
 *
 * A expiração não é porta de segurança: a leitura de direitos já ignora
 * qualquer linha vencida. Ela é higiene de dado — sem isso o painel contaria
 * como assinante quem deixou de ser um.
 */
export async function executarCronDeAssinaturas(opcoes: {
  completa: boolean;
}): Promise<ResultadoDoCron> {
  const reconciliacao = reconciliacaoLigada()
    ? await reconciliarAssinaturasPeriodicamente({ completa: opcoes.completa })
    : "desligada";

  // Primeiro as assinaturas, que revogam os direitos ligados a elas; depois a
  // varredura solta, que pega direitos órfãos de compra ou concessão manual.
  const assinaturas = await expirarAssinaturasVencidas();
  const direitos = await expirarDireitosVencidos();

  if (assinaturas > 0 || direitos > 0) {
    await log.info({
      channel: "JOBS",
      message: `Ciclos encerrados: ${assinaturas} assinatura(s), ${direitos} direito(s)`,
      context: { assinaturas, direitos },
    });
  }

  return { reconciliacao, assinaturas, direitos };
}
