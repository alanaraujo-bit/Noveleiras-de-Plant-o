/**
 * Aritmética do ciclo manual, com as datas exatas do combinado.
 *
 * Este arquivo existe porque a regra que decide **quantos dias alguém recebeu
 * pelo dinheiro que pagou** não pode depender de um banco de pé, de um provedor
 * respondendo ou de o cron ter passado. Ela é uma função de datas, e é aqui que
 * cada caso está escrito com dia e mês, como foi combinado:
 *
 *   paga 11/09                       → 11/09 → 11/10
 *   vence 11/10, paga 08/10          → 11/10 → 11/11   (não 08/11)
 *   vence 11/10, paga 14/10          → 11/10 → 11/11   (não 14/11)
 *   vence 11/10, volta 25/11         → 25/11 → 25/12
 *
 * Os dois do meio são o coração da coisa: renovar antes não pode custar dias, e
 * a carência é prazo para pagar — não desconto para quem atrasa.
 */
import { describe, expect, it } from "vitest";

import {
  avisoDeRenovacao,
  CARENCIA_MANUAL_MS,
  fimDaCarencia,
  inicioDoCiclo,
  mensagemDeRenovacao,
} from "./ciclo";
import { fimDoCiclo, PLANO_MENSAL } from "./planos";

/** Data local ao meio-dia: longe de qualquer virada de fuso ou horário de verão. */
function dia(ano: number, mes: number, d: number, hora = 12): Date {
  return new Date(ano, mes - 1, d, hora, 0, 0, 0);
}

function cicloAPartirDe(inicio: Date): Date {
  return fimDoCiclo(PLANO_MENSAL, inicio);
}

describe("início do ciclo manual", () => {
  it("primeira assinatura começa no dia do pagamento", () => {
    const pago = dia(2026, 9, 11);
    const inicio = inicioDoCiclo(null, pago);

    expect(inicio).toEqual(pago);
    expect(cicloAPartirDe(inicio)).toEqual(dia(2026, 10, 11));
  });

  it("renovação antecipada encadeia no vencimento, não no pagamento", () => {
    // Vence 11/10, ela paga 08/10. Perder três dias por renovar antes seria
    // punir exatamente o comportamento que se quer incentivar.
    const vence = dia(2026, 10, 11);
    const inicio = inicioDoCiclo(vence, dia(2026, 10, 8));

    expect(inicio).toEqual(vence);
    expect(cicloAPartirDe(inicio)).toEqual(dia(2026, 11, 11));
  });

  it("renovação no último dia não perde nada", () => {
    const vence = dia(2026, 10, 11);
    const inicio = inicioDoCiclo(vence, dia(2026, 10, 10, 23));

    expect(inicio).toEqual(vence);
    expect(cicloAPartirDe(inicio)).toEqual(dia(2026, 11, 11));
  });

  it("renovação dentro da carência mantém a data original do plano", () => {
    // Vence 11/10, paga 14/10 → 11/10 → 11/11. Os três dias de atraso saem do
    // ciclo novo: senão atrasar de propósito viraria assinatura mais barata.
    const vence = dia(2026, 10, 11);
    const inicio = inicioDoCiclo(vence, dia(2026, 10, 14));

    expect(inicio).toEqual(vence);
    expect(cicloAPartirDe(inicio)).toEqual(dia(2026, 11, 11));
  });

  it("último instante da carência ainda encadeia", () => {
    const vence = dia(2026, 10, 11);
    const limite = new Date(vence.getTime() + CARENCIA_MANUAL_MS);

    expect(inicioDoCiclo(vence, limite)).toEqual(vence);
  });

  it("um instante depois da carência já é período novo", () => {
    const vence = dia(2026, 10, 11);
    const passou = new Date(vence.getTime() + CARENCIA_MANUAL_MS + 1);

    expect(inicioDoCiclo(vence, passou)).toEqual(passou);
  });

  it("quem volta muito depois começa no dia em que pagou", () => {
    // Terminou 11/10, carência até 16/10, ela volta 25/11.
    const inicio = inicioDoCiclo(dia(2026, 10, 11), dia(2026, 11, 25));

    expect(inicio).toEqual(dia(2026, 11, 25));
    expect(cicloAPartirDe(inicio)).toEqual(dia(2026, 12, 25));
  });

  it("dois Pix pagos de verdade encadeiam dois meses", () => {
    // Caso legítimo: ela gerou dois e pagou os dois. Cada pagamento real rende
    // exatamente um mês — nem menos (seria ficar com o dinheiro dela), nem
    // mais (seria duplicar por engano).
    const primeiro = inicioDoCiclo(null, dia(2026, 9, 11));
    const fim1 = cicloAPartirDe(primeiro);

    const segundo = inicioDoCiclo(fim1, dia(2026, 9, 11, 13));
    const fim2 = cicloAPartirDe(segundo);

    expect(fim1).toEqual(dia(2026, 10, 11));
    expect(fim2).toEqual(dia(2026, 11, 11));
  });

  it("a carência não é negociada pelo status, só pela data", () => {
    // A mesma entrada tem de dar a mesma saída, tenha o cron passado ou não.
    const vence = dia(2026, 10, 11);
    const pago = dia(2026, 10, 14);

    expect(inicioDoCiclo(vence, pago)).toEqual(inicioDoCiclo(vence, pago));
  });

  it("a carência combinada são cinco dias", () => {
    expect(fimDaCarencia(dia(2026, 10, 11))).toEqual(dia(2026, 10, 16));
  });
});

describe("aviso de renovação", () => {
  const vence = dia(2026, 10, 11);
  const ate = fimDaCarencia(vence);

  it("fica quieto quando ainda falta muito", () => {
    const aviso = avisoDeRenovacao(vence, ate, dia(2026, 9, 20));

    expect(aviso.momento).toBe("em-dia");
    expect(aviso.merecerAviso).toBe(false);
  });

  it("avisa discretamente na semana final", () => {
    const aviso = avisoDeRenovacao(vence, ate, dia(2026, 10, 6));

    expect(aviso.momento).toBe("vencendo");
    const mensagem = mensagemDeRenovacao(aviso);
    // Dias no título, porque "vence em 5 dias" se entende sem fazer conta; a
    // data completa fica no detalhe, para quem quiser marcar.
    expect(mensagem.titulo).toBe("Seu Plantão vence em 5 dias");
    expect(mensagem.detalhe).toContain("11 de outubro");
    expect(mensagem.acao).toBe("Renovar agora");
  });

  it("fala em amanhã na véspera", () => {
    const aviso = avisoDeRenovacao(vence, ate, dia(2026, 10, 10));

    expect(aviso.momento).toBe("ultimo-dia");
    expect(mensagemDeRenovacao(aviso).titulo).toBe("Seu Plantão vence amanhã");
  });

  it("na carência diz até quando dá para renovar", () => {
    const aviso = avisoDeRenovacao(vence, ate, dia(2026, 10, 13));
    const mensagem = mensagemDeRenovacao(aviso);

    expect(aviso.momento).toBe("carencia");
    expect(mensagem.titulo).toBe("Seu Plantão venceu");
    expect(mensagem.detalhe).toContain("16 de outubro");
  });

  it("depois da carência não promete acesso que não existe mais", () => {
    const aviso = avisoDeRenovacao(vence, ate, dia(2026, 10, 17));
    const mensagem = mensagemDeRenovacao(aviso);

    expect(aviso.momento).toBe("encerrado");
    // A única promessa que sobrevive: compra avulsa é para sempre.
    expect(mensagem.detalhe).toContain("comprou");
  });

  it("nenhuma mensagem usa vocabulário de sistema financeiro", () => {
    const proibidas =
      /preapproval|entitlement|recorr|ciclo|carência|billing|assinatura recorrente/i;

    for (const agora of [
      dia(2026, 9, 20),
      dia(2026, 10, 6),
      dia(2026, 10, 10),
      dia(2026, 10, 13),
      dia(2026, 10, 17),
    ]) {
      const m = mensagemDeRenovacao(avisoDeRenovacao(vence, ate, agora));
      expect(`${m.titulo} ${m.detalhe} ${m.acao}`).not.toMatch(proibidas);
    }
  });
});
