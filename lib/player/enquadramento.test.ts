/**
 * O enquadramento com a conversa aberta, provado com números.
 *
 * Cada teste fixa uma promessa da experiência:
 *
 * - em tela cheia, a caixa do vídeo é exatamente o "cobrir" de sempre;
 * - com a conversa aberta, o quadro inteiro cabe acima do painel — nada de
 *   rosto ou legenda cortado para caber a conversa;
 * - o vídeo nunca fica atrás do teclado nem vira miniatura;
 * - no desktop, o painel vai para o lado e o vídeo fica com a altura inteira.
 */
import { describe, expect, it } from "vitest";

import {
  caixaDoVideo,
  enquadramento,
  layoutDaConversa,
  PROPORCAO_VERTICAL,
} from "./enquadramento";

/** iPhone 16 Pro Max no navegador. */
const CELULAR = { largura: 440, altura: 956 };

/** Onde o quadro do vídeo termina na tela, depois da transformação. */
function quadroNaTela(
  W: number,
  H: number,
  proporcao: number,
  e: { escala: number; x: number; y: number },
) {
  const caixa = caixaDoVideo(W, H, proporcao);
  const esquerda = W / 2 + e.escala * (caixa.esquerda - W / 2) + e.x;
  const topo = e.escala * caixa.topo + e.y;
  return {
    esquerda,
    topo,
    direita: esquerda + e.escala * caixa.largura,
    fundo: topo + e.escala * caixa.altura,
  };
}

describe("caixa do vídeo", () => {
  it("em tela cheia equivale ao cobrir de sempre: mesma escala, centrada", () => {
    const caixa = caixaDoVideo(440, 956, PROPORCAO_VERTICAL);

    // A altura cobre a tela; a largura transborda igual dos dois lados — que é
    // exatamente o que `object-fit: cover` faria dentro de uma caixa da tela.
    expect(caixa.altura).toBe(956);
    expect(caixa.largura).toBeCloseTo(956 * (9 / 16));
    expect(caixa.esquerda).toBeCloseTo((440 - caixa.largura) / 2);
    expect(caixa.topo).toBe(0);
  });

  it("sem proporção conhecida, devolve a tela: o comportamento antigo, exato", () => {
    expect(caixaDoVideo(440, 956, null)).toEqual({
      largura: 440,
      altura: 956,
      esquerda: 0,
      topo: 0,
    });
  });
});

describe("layout da conversa", () => {
  it("no celular, embaixo, e o vídeo fica com a maior parte", () => {
    const layout = layoutDaConversa(CELULAR);

    expect(layout.lado).toBe("baixo");
    expect(layout.painel).toBeGreaterThanOrEqual(956 * 0.4);
    expect(layout.painel).toBeLessThanOrEqual(956 * 0.46);
  });

  it("com teclado, o painel encolhe para o vídeo continuar visível", () => {
    const sem = layoutDaConversa(CELULAR);
    const com = layoutDaConversa({ ...CELULAR, teclado: 330 });

    expect(com.painel).toBeLessThan(sem.painel);
    // Ao menos um quarto da tela continua sendo cena.
    expect(956 - 330 - com.painel).toBeGreaterThanOrEqual(956 * 0.25);
  });

  it("no desktop, o painel vai para o lado", () => {
    const layout = layoutDaConversa({ largura: 1440, altura: 900 });
    expect(layout.lado).toBe("direita");
    expect(layout.painel).toBeGreaterThanOrEqual(360);
    expect(layout.painel).toBeLessThanOrEqual(440);
  });

  it("tablet em pé continua com o painel embaixo", () => {
    expect(layoutDaConversa({ largura: 820, altura: 1180 }).lado).toBe("baixo");
  });
});

describe("enquadramento com a conversa aberta", () => {
  it("o quadro inteiro cabe acima do painel, sem corte", () => {
    const layout = layoutDaConversa({ ...CELULAR, topo: 10 });
    const e = enquadramento(layout, PROPORCAO_VERTICAL);
    const q = quadroNaTela(440, 956, PROPORCAO_VERTICAL, e);

    // Nada sai pelas laterais: o rosto na borda do quadro continua lá.
    expect(q.esquerda).toBeGreaterThanOrEqual(-0.5);
    expect(q.direita).toBeLessThanOrEqual(440.5);
    // Começa abaixo da área segura e termina no máximo 12px sob a borda do
    // painel — a dobra que o faz parecer apoiado, e não cortado.
    expect(q.topo).toBeGreaterThanOrEqual(10 - 0.5);
    expect(q.fundo).toBeLessThanOrEqual(956 - layout.painel + 12 + 0.5);
  });

  it("não vira miniatura: o vídeo continua com boa parte da tela", () => {
    const e = enquadramento(layoutDaConversa(CELULAR), PROPORCAO_VERTICAL);
    const q = quadroNaTela(440, 956, PROPORCAO_VERTICAL, e);

    // Mais da metade da altura da tela e dois terços da largura.
    expect(q.fundo - q.topo).toBeGreaterThan(956 * 0.55);
    expect(q.direita - q.esquerda).toBeGreaterThan(440 * 0.66);
  });

  it("mostra mais do quadro que simplesmente encolher a tela cheia", () => {
    const layout = layoutDaConversa(CELULAR);
    const inteiro = quadroNaTela(
      440,
      956,
      PROPORCAO_VERTICAL,
      enquadramento(layout, PROPORCAO_VERTICAL),
    );
    const recortado = quadroNaTela(440, 956, 440 / 956, enquadramento(layout, null));

    // Com a caixa na proporção do conteúdo, a versão reduzida é mais larga que
    // o recorte da tela cheia reduzido.
    expect(inteiro.direita - inteiro.esquerda).toBeGreaterThan(
      recortado.direita - recortado.esquerda,
    );
  });

  it("com o teclado aberto, nada fica atrás dele", () => {
    const layout = layoutDaConversa({ ...CELULAR, teclado: 330 });
    const q = quadroNaTela(
      440,
      956,
      PROPORCAO_VERTICAL,
      enquadramento(layout, PROPORCAO_VERTICAL),
    );

    expect(q.fundo).toBeLessThanOrEqual(956 - 330 - layout.painel + 12 + 0.5);
    expect(q.topo).toBeGreaterThanOrEqual(-0.5);
  });

  it("no desktop, o quadro vertical inteiro fica ao lado do painel, na altura toda", () => {
    const layout = layoutDaConversa({ largura: 1440, altura: 900, topo: 10 });
    const q = quadroNaTela(
      1440,
      900,
      PROPORCAO_VERTICAL,
      enquadramento(layout, PROPORCAO_VERTICAL),
    );

    expect(q.direita).toBeLessThanOrEqual(1440 - layout.painel + 0.5);
    expect(q.esquerda).toBeGreaterThanOrEqual(-0.5);
    // Altura praticamente inteira da janela: o desktop tem largura sobrando e
    // usa essa largura para dar mais vídeo, não menos.
    expect(q.fundo - q.topo).toBeGreaterThan(900 * 0.95);
    // Centralizado na área livre.
    const centro = (q.esquerda + q.direita) / 2;
    expect(centro).toBeCloseTo((1440 - layout.painel) / 2, 0);
  });

  it("nunca amplia além do tamanho de tela cheia", () => {
    const e = enquadramento(
      { largura: 440, altura: 956, lado: "baixo", painel: 0, teclado: 0, topo: 0 },
      PROPORCAO_VERTICAL,
    );
    expect(e.escala).toBeLessThanOrEqual(1);
  });
});
