import { expirarDireitosVencidos } from "@/lib/access/direitos";
import { log } from "@/lib/painel/log";

import {
  expirarAssinaturasVencidas,
  marcarVencimentosManuais,
  reconciliarAssinaturasPeriodicamente,
  reconciliarPixPendentes,
  type ResumoDaReconciliacao,
  type ResumoDoPix,
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
  pix: ResumoDoPix | "desligada";
  vencimentosManuais: number;
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
  // 1 e 2. Mercado Pago → reconciliação, que já decide pendência e
  // tolerância: renovação pendente vira PAST_DUE com `graceUntil`, e é esse
  // `graceUntil` que tira a assinatura da expiração logo abaixo.
  const reconciliacao = reconciliacaoLigada()
    ? await reconciliarAssinaturasPeriodicamente({ completa: opcoes.completa })
    : "desligada";

  // O mesmo passo, para quem renova à mão. Vem junto do primeiro e pelo mesmo
  // motivo: a assinatura por Pix não tem preapproval e ficaria fora da
  // varredura acima — e é justamente ela que depende de um webhook chegar.
  const pix = reconciliacaoLigada()
    ? await reconciliarPixPendentes()
    : "desligada";

  // 2.5. Quem venceu entra em carência **registrada**. Não corta nada: o
  // acesso já está garantido até `graceUntil`, e este passo só grava o fato
  // datado de que o ciclo acabou — a matéria-prima do aviso de renovação.
  const vencimentosManuais = await marcarVencimentosManuais();

  // 3. Só então expirar. Assinatura cuja reconciliação falhou nesta execução
  // fica de fora dela: sem saber o que o provedor diz, cortar pode ser cortar
  // um pagante. A próxima execução decide.
  const ignorar = reconciliacao === "desligada" ? [] : reconciliacao.falhasIds;

  // Primeiro as assinaturas, que revogam os direitos ligados a elas; depois a
  // varredura solta, que pega direitos órfãos de compra ou concessão manual.
  const assinaturas = await expirarAssinaturasVencidas(new Date(), { ignorar });
  const direitos = await expirarDireitosVencidos();

  if (assinaturas > 0 || direitos > 0 || vencimentosManuais > 0) {
    await log.info({
      channel: "JOBS",
      message:
        `Ciclos encerrados: ${assinaturas} assinatura(s), ${direitos} direito(s)` +
        (vencimentosManuais > 0
          ? `, ${vencimentosManuais} em carência de renovação`
          : ""),
      context: { assinaturas, direitos, vencimentosManuais, pix },
    });
  }

  return { reconciliacao, pix, vencimentosManuais, assinaturas, direitos };
}
