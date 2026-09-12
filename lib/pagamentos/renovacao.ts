/**
 * A situação da renovação de uma pessoa, pronta para qualquer superfície.
 *
 * Perfil, tela de assinatura e — quando existirem — e-mail e push leem daqui.
 * A alternativa seria cada tela olhar `billingMode`, `currentPeriodEnd`,
 * `graceUntil` e `status` e tirar a própria conclusão; foi assim que "renova
 * em" e "cancelada" já apareceram divergindo em duas telas deste aplicativo.
 *
 * Deriva de **datas**, não de o cron ter rodado. Uma assinatura cujo ciclo
 * acabou há dez minutos está em carência para quem lê daqui, mesmo que o
 * `status` no banco ainda diga ACTIVE porque o cron só passa de madrugada.
 */

import type { Subscription } from "@prisma/client";

import { avisoDeRenovacao, fimDaCarencia, type AvisoDeRenovacao } from "./ciclo";
import { CARENCIA_MANUAL_MS } from "./ciclo";

export type SituacaoDaRenovacao = {
  /** Existe assinatura paga a renovar? */
  temPlano: boolean;
  manual: boolean;
  vence: Date | null;
  /** Só na renovação manual: até quando ainda dá para pagar sem perder acesso. */
  renovarAte: Date | null;
  cancelada: boolean;
  aviso: AvisoDeRenovacao | null;
};

/**
 * A expiração devolve o plano para FREE, e é assim que tem de ser — quem não
 * pagou não é assinante. Mas `billingMode` **sobrevive** ao corte, e é ele que
 * distingue "nunca assinou" de "assinava por Pix e deixou vencer".
 *
 * A diferença não é técnica, é de tom: para a primeira, a tela convida a
 * conhecer o plano; para a segunda, ela reconhece o que aconteceu e diz o que
 * continua sendo dela.
 */
function terminouRenovandoAMao(
  assinatura: Pick<Subscription, "status" | "billingMode" | "currentPeriodEnd">,
): boolean {
  return (
    assinatura.status === "EXPIRED" &&
    assinatura.billingMode === "MANUAL_RENEW" &&
    assinatura.currentPeriodEnd !== null
  );
}

const PLANOS_PAGOS = new Set(["MONTHLY", "ANNUAL", "PREMIUM", "VIP"]);

export function situacaoDaRenovacao(
  assinatura: Pick<
    Subscription,
    | "plan"
    | "status"
    | "billingMode"
    | "currentPeriodEnd"
    | "graceUntil"
    | "cancelAtPeriodEnd"
  > | null,
  agora: Date = new Date(),
): SituacaoDaRenovacao {
  const vazio: SituacaoDaRenovacao = {
    temPlano: false,
    manual: false,
    vence: null,
    renovarAte: null,
    cancelada: false,
    aviso: null,
  };

  if (!assinatura) return vazio;

  // Plano já encerrado, mas era Pix: o aviso continua valendo, agora com o tom
  // de quem terminou — e o acesso não volta sozinho.
  if (terminouRenovandoAMao(assinatura)) {
    const vence = assinatura.currentPeriodEnd!;
    const renovarAte =
      assinatura.graceUntil ?? fimDaCarencia(vence, CARENCIA_MANUAL_MS);
    return {
      temPlano: false,
      manual: true,
      vence,
      renovarAte,
      cancelada: false,
      aviso: avisoDeRenovacao(vence, renovarAte, agora),
    };
  }

  if (!PLANOS_PAGOS.has(assinatura.plan)) return vazio;

  const manual = assinatura.billingMode === "MANUAL_RENEW";
  const vence = assinatura.currentPeriodEnd;
  if (!vence) return { ...vazio, temPlano: true, manual };

  // No Pix, `graceUntil` nasce com o ciclo e é a data que a expiração respeita
  // — então é ela, e não uma conta refeita aqui, que a tela deve prometer.
  const renovarAte = manual
    ? (assinatura.graceUntil ?? fimDaCarencia(vence, CARENCIA_MANUAL_MS))
    : null;

  return {
    temPlano: true,
    manual,
    vence,
    renovarAte,
    cancelada: assinatura.cancelAtPeriodEnd,
    // Quem renova sozinho no cartão não precisa ser lembrado de nada: o aviso
    // existe para quem tem algo a fazer. Avisar mesmo assim seria pedir uma
    // ação que não existe.
    aviso: manual ? avisoDeRenovacao(vence, renovarAte!, agora) : null,
  };
}
