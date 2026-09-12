/**
 * Onde o vídeo fica quando a conversa abre.
 *
 * Puro de propósito: largura, altura e o tamanho do painel entram, uma escala e
 * um deslocamento saem. É o que permite provar o enquadramento com números — "o
 * quadro inteiro cabe", "nada fica atrás do teclado" — sem montar um vídeo.
 *
 * A decisão que organiza tudo: **o vídeo abre espaço, não é coberto.** Ele
 * encolhe e sobe para a área que o painel deixa livre, inteiro, em vez de o
 * painel subir por cima dele. Uma novela vertical tem rosto no terço de cima e
 * legenda no terço de baixo; cortar qualquer um dos dois para caber um painel é
 * trocar a cena pela conversa, que é o oposto do que se quer.
 *
 * O movimento é só `transform` — escala e translação —, aplicado a um palco em
 * volta do `<video>`. Nada de largura, altura ou `object-fit` mudando por
 * quadro: isso recalcularia layout a cada frame num aparelho mediano e o vídeo
 * engasgaria justamente durante a animação. E como o elemento de vídeo nunca
 * muda, nada recarrega, nada volta ao começo e nada perde o que já baixou.
 */

/** Proporção padrão das novelas verticais, usada enquanto os metadados não chegam. */
export const PROPORCAO_VERTICAL = 9 / 16;

/** A partir desta largura o painel vai para o lado, e não para baixo. */
export const LARGURA_LATERAL = 768;

/**
 * Quanto o vídeo pode entrar por baixo da borda arredondada do painel.
 *
 * Doze pixels: o suficiente para a borda do painel parecer apoiada sobre a
 * cena, e não uma régua cortando o vídeo; pouco demais para esconder legenda.
 */
const DOBRA_PX = 12;

/** O vídeo nunca encolhe além disto, nem com o teclado aberto num aparelho pequeno. */
const ESCALA_MINIMA = 0.2;

export type LadoDoPainel = "baixo" | "direita";

export type LayoutDaConversa = {
  largura: number;
  altura: number;
  lado: LadoDoPainel;
  /** Altura do painel (embaixo) ou largura (ao lado), em pixels. */
  painel: number;
  /** Altura do teclado virtual. Zero sem teclado. */
  teclado: number;
  /** Área segura do topo mais o quanto o navegador rolou o viewport visual. */
  topo: number;
};

/**
 * Tamanho do painel e de que lado ele fica.
 *
 * No celular, embaixo, ocupando pouco menos da metade: o vídeo fica com a maior
 * parte, porque é ele o conteúdo. Com o teclado aberto o painel encolhe para
 * não empurrar o vídeo para fora da tela — a conversa continua legível numa
 * faixa menor, e a cena continua visível acima dela.
 *
 * No tablet deitado e no desktop há largura sobrando, e ela é mais barata que
 * altura: o painel vai para a direita e o vídeo fica com a altura inteira.
 */
export function layoutDaConversa({
  largura,
  altura,
  teclado = 0,
  topo = 0,
}: {
  largura: number;
  altura: number;
  teclado?: number;
  topo?: number;
}): LayoutDaConversa {
  if (largura >= LARGURA_LATERAL && largura > altura * 0.9) {
    return {
      largura,
      altura,
      lado: "direita",
      painel: limitar(Math.round(largura * 0.34), 360, 440),
      teclado,
      topo,
    };
  }

  const aberto = limitar(Math.round(altura * 0.44), 300, 520);
  // Com teclado, o vídeo guarda ao menos um quarto da tela. Abaixo disso a
  // cena vira miniatura e deixa de ser assistível.
  const painel =
    teclado > 0
      ? Math.max(220, Math.min(aberto, altura - teclado - Math.round(altura * 0.26)))
      : aberto;

  return { largura, altura, lado: "baixo", painel, teclado, topo };
}

export type CaixaDoVideo = {
  largura: number;
  altura: number;
  esquerda: number;
  topo: number;
};

/**
 * A caixa do elemento de vídeo, do tamanho de "cobrir" a tela.
 *
 * Em tela cheia é idêntica ao `object-fit: cover` de sempre — mesma escala,
 * mesmo recorte —, só que o recorte é feito pela lâmina, e não pelo próprio
 * elemento. Essa diferença é invisível parada e decisiva ao encolher: reduzida,
 * a caixa mostra o quadro **inteiro**, laterais incluídas, em vez do mesmo
 * recorte estreito da tela cheia, só que menor.
 *
 * Sem proporção conhecida, devolve a tela: o comportamento antigo, exato.
 */
export function caixaDoVideo(
  largura: number,
  altura: number,
  proporcao: number | null,
): CaixaDoVideo {
  if (!proporcao || !Number.isFinite(proporcao) || proporcao <= 0) {
    return { largura, altura, esquerda: 0, topo: 0 };
  }
  const w = Math.max(largura, altura * proporcao);
  const h = Math.max(altura, largura / proporcao);
  return {
    largura: w,
    altura: h,
    esquerda: (largura - w) / 2,
    topo: (altura - h) / 2,
  };
}

export type Enquadramento = {
  /** Escala do palco, a partir do topo ao centro. */
  escala: number;
  x: number;
  y: number;
};

/** Sem conversa aberta: o palco em repouso. */
export const ENQUADRAMENTO_NEUTRO: Enquadramento = { escala: 1, x: 0, y: 0 };

/**
 * Escala e deslocamento do palco com a conversa aberta.
 *
 * O palco tem o tamanho da lâmina e a origem da transformação no topo, ao
 * centro. O quadro do vídeo é encaixado inteiro na área livre — acima do painel
 * no celular, à esquerda dele no desktop — e centralizado nela.
 */
export function enquadramento(
  layout: LayoutDaConversa,
  proporcao: number | null,
): Enquadramento {
  const { largura: W, altura: H, lado, painel, teclado, topo } = layout;
  const caixa = caixaDoVideo(W, H, proporcao);

  const areaLargura = lado === "direita" ? W - painel : W;
  const areaFundo =
    lado === "direita" ? H - teclado : H - teclado - painel + DOBRA_PX;
  const areaAltura = Math.max(1, areaFundo - topo);

  const escala = limitar(
    Math.min(1, areaLargura / caixa.largura, areaAltura / caixa.altura),
    ESCALA_MINIMA,
    1,
  );

  // Centro do quadro no centro da área livre, nos dois eixos. Com a origem no
  // topo ao centro, um ponto (px, py) do palco vai para
  // (W/2 + escala·(px − W/2) + x, escala·py + y).
  const alvoTopo = topo + (areaAltura - escala * caixa.altura) / 2;
  return {
    escala,
    x: areaLargura / 2 - W / 2,
    y: alvoTopo - escala * caixa.topo,
  };
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}
