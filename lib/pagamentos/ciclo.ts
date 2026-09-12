/**
 * Aritmética de ciclo da renovação manual.
 *
 * Puro de propósito: sem banco, sem provedor, sem relógio escondido. Cada
 * regra comercial desta fase é decidida por uma função daqui, e por isso cada
 * uma tem teste com as datas exatas do combinado.
 *
 * As duas datas que governam tudo, e a diferença entre elas:
 *
 *   currentPeriodEnd  até quando está **pago**. É o "próximo vencimento" que
 *                     a tela mostra e a data de onde o ciclo seguinte nasce.
 *   graceUntil        até quando o **acesso** continua de pé. No Pix é o
 *                     vencimento mais a carência.
 *
 * A carência é prazo para pagar, não dia grátis. Quem vence 11/10 e paga 14/10
 * recebe 11/10 → 11/11, e não 14/10 → 14/11: os três dias de atraso saem do
 * ciclo novo, senão atrasar de propósito viraria assinatura mais barata.
 */

/**
 * Carência da renovação manual: cinco dias depois do vencimento.
 *
 * Maior que os três dias da tolerância do cartão (`TOLERANCIA_MS`), e são
 * coisas diferentes: lá o provedor está tentando cobrar sozinho e o prazo
 * serve para a retentativa dele; aqui quem precisa agir é uma pessoa, que
 * pode estar viajando, sem saldo ou simplesmente sem ter visto o aviso.
 */
export const CARENCIA_MANUAL_MS = 5 * 86_400_000;

/**
 * Onde o ciclo pago por esta cobrança começa.
 *
 * Decidida **só por datas**. Nunca pelo `status` da assinatura: o status
 * depende de o cron ter passado, e um cron atrasado ou adiantado não pode
 * mudar quanto tempo alguém recebeu pelo dinheiro que pagou.
 *
 * Os quatro casos, com os exemplos que os definem:
 *
 *   sem ciclo anterior      primeira assinatura — começa no pagamento
 *   anterior no futuro      renovação antecipada: vence 11/10, paga 08/10
 *                           → 11/10, e o novo fim é 11/11 (não 08/11).
 *                           Ninguém perde dias por renovar antes.
 *   dentro da carência      vence 11/10, paga 14/10 → 11/10 → 11/11.
 *                           O atraso sai do ciclo novo.
 *   depois da carência      terminou 11/10, volta 25/11 → 25/11 → 25/12.
 *                           Período novo, começando no pagamento.
 */
export function inicioDoCiclo(
  fimAnterior: Date | null,
  pagoEm: Date,
  carenciaMs: number = CARENCIA_MANUAL_MS,
): Date {
  if (!fimAnterior) return pagoEm;
  if (fimAnterior.getTime() > pagoEm.getTime()) return fimAnterior;
  if (pagoEm.getTime() <= fimAnterior.getTime() + carenciaMs) return fimAnterior;
  return pagoEm;
}

/** Até quando o acesso sobrevive a um ciclo manual que venceu. */
export function fimDaCarencia(
  fimDoPeriodo: Date,
  carenciaMs: number = CARENCIA_MANUAL_MS,
): Date {
  return new Date(fimDoPeriodo.getTime() + carenciaMs);
}

// ------------------------------------------------------ aviso de renovação

/**
 * Em que momento da vida do ciclo a pessoa está.
 *
 * O domínio conhece estes cinco nomes, e a tela, o aviso no aplicativo e uma
 * futura notificação leem todos daqui. Sem isto, cada superfície decidiria
 * sozinha o que "vencendo" quer dizer, e elas divergiriam na primeira
 * mudança de prazo.
 *
 *   em-dia     falta mais de uma semana
 *   vencendo   a semana final — aviso discreto, sem pressa
 *   ultimo-dia vence hoje ou amanhã
 *   carencia   venceu, mas o acesso continua até o fim da carência
 *   encerrado  a carência acabou; o catálogo premium fechou
 */
export type MomentoDaRenovacao =
  | "em-dia"
  | "vencendo"
  | "ultimo-dia"
  | "carencia"
  | "encerrado";

export type AvisoDeRenovacao = {
  momento: MomentoDaRenovacao;
  /** Dias inteiros até o vencimento. Negativo depois dele. */
  diasParaVencer: number;
  /** Vale a pena mostrar algo? `em-dia` não merece ocupar tela. */
  merecerAviso: boolean;
  vence: Date;
  /** Até quando ainda dá para renovar sem perder o acesso. */
  renovarAte: Date;
};

/** A partir de quantos dias antes do vencimento o aviso discreto aparece. */
const JANELA_DE_AVISO_DIAS = 7;

function diasInteiros(de: Date, ate: Date): number {
  return Math.ceil((ate.getTime() - de.getTime()) / 86_400_000);
}

/**
 * O momento da renovação manual, a partir das datas e de agora.
 *
 * Recebe `fimDaCarencia` separado em vez de recalcular: numa assinatura real
 * quem manda é o `graceUntil` gravado, e derivar de novo aqui abriria a porta
 * para a tela dizer uma data e o banco cortar noutra.
 */
export function avisoDeRenovacao(
  vence: Date,
  fimDaCarenciaEm: Date,
  agora: Date = new Date(),
): AvisoDeRenovacao {
  const dias = diasInteiros(agora, vence);

  const momento: MomentoDaRenovacao =
    agora.getTime() >= fimDaCarenciaEm.getTime()
      ? "encerrado"
      : agora.getTime() >= vence.getTime()
        ? "carencia"
        : dias <= 1
          ? "ultimo-dia"
          : dias <= JANELA_DE_AVISO_DIAS
            ? "vencendo"
            : "em-dia";

  return {
    momento,
    diasParaVencer: dias,
    merecerAviso: momento !== "em-dia",
    vence,
    renovarAte: fimDaCarenciaEm,
  };
}

/** "11 de outubro" — a forma como as telas falam de data nesta fase. */
export function dataPorExtenso(data: Date): string {
  return data.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

/**
 * O que a pessoa lê sobre a própria renovação.
 *
 * Mora no domínio, e não na tela, porque a mesma frase precisa valer no
 * aplicativo, num e-mail e num push — e porque "seu plano venceu" dito de três
 * jeitos diferentes parece três problemas diferentes.
 *
 * Sem urgência fabricada, sem contagem regressiva em vermelho: o prazo real já
 * é informação suficiente, e apertar quem só quer assistir novela é o caminho
 * mais curto para o cancelamento.
 */
export function mensagemDeRenovacao(aviso: AvisoDeRenovacao): {
  titulo: string;
  detalhe: string;
  acao: string;
} {
  switch (aviso.momento) {
    case "encerrado":
      return {
        titulo: "Seu Plantão terminou",
        detalhe:
          "As novelas que você comprou continuam suas. Para voltar ao catálogo inteiro, é só renovar.",
        acao: "Renovar com Pix",
      };
    case "carencia":
      return {
        titulo: "Seu Plantão venceu",
        detalhe: `Você ainda pode renovar até ${dataPorExtenso(aviso.renovarAte)} sem perder o acesso.`,
        acao: "Renovar com Pix",
      };
    case "ultimo-dia":
      return {
        titulo:
          aviso.diasParaVencer <= 0
            ? "Seu Plantão vence hoje"
            : "Seu Plantão vence amanhã",
        detalhe: "Renove em poucos toques e siga de onde parou.",
        acao: "Renovar agora",
      };
    case "vencendo":
      return {
        titulo: `Seu Plantão vence em ${dataPorExtenso(aviso.vence)}`,
        detalhe: `Faltam ${aviso.diasParaVencer} dias. Dá para renovar quando quiser — o tempo que sobrar não se perde.`,
        acao: "Renovar agora",
      };
    default:
      return {
        titulo: `Seu Plantão vale até ${dataPorExtenso(aviso.vence)}`,
        detalhe: "Está tudo certo por aqui.",
        acao: "Renovar agora",
      };
  }
}
