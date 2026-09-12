/**
 * A matemática da recomendação, sem banco.
 *
 * Tudo aqui é função pura: recebe fatos já lidos (progresso, eventos, tempo
 * assistido) e devolve perfil e pontuação. Separado de propósito — quem lê o
 * banco é `lib/repositories/afinidade` e `lib/repositories/tendencia`; quem
 * decide o que cada fato vale é este arquivo, e por isso ele é o que tem teste.
 * Mudar um peso sem um teste de ordenação ao lado é trocar o algoritmo às
 * cegas.
 *
 * ## O que a pessoa gosta
 *
 * Derivado do que ela fez, nunca do que ela disse. Terminar um episódio,
 * curtir, comentar, enviar e favoritar são fatos datados; passar o dedo em um
 * segundo também é. O perfil é a soma desses fatos com peso e prazo de
 * validade.
 *
 * Três escalas de tempo convivem:
 *
 * - **Gosto** — meia-vida de duas semanas. É o que ela costuma assistir.
 * - **Momento** — um bônus que some em poucas horas. É o que ela está com
 *   vontade agora: quem acabou de maratonar uma novela de lobisomem quer a
 *   próxima de lobisomem hoje, mesmo que o histórico seja de CEO.
 * - **Recusa** — só vale por três semanas. "Não quero esta" costuma ser "não
 *   agora", e um feed que nunca mais oferece uma obra fica menor a cada
 *   descarte.
 */

// ---------------------------------------------------------------- pesos
//
// A escala é grosseira de propósito: a diferença entre "assistiu 40 minutos"
// e "passou o dedo" precisa ser óbvia, e afinar decimais sem base de usuários
// para medir seria fingir precisão.

export const PESO = {
  /** Assistiu até o fim. O sinal mais forte que existe sem pedir nada. */
  concluiu: 5,
  /**
   * Passou de 40% do episódio. Só vale para progresso sem tempo assistido
   * registrado — linhas antigas, de antes de o tempo virar evento. Onde há
   * minutos, os minutos dizem mais.
   */
  assistiuBastante: 2.5,
  favoritou: 6,
  curtiu: 4,
  comentou: 5,
  enviou: 5,
  /** Ficou numa lâmina além do limiar de permanência. */
  permaneceu: 1,
  /** Abriu a ficha da novela: interesse declarado por um toque. */
  abriu: 0.5,
  /** Viu a cena e passou: é um "não" para esta obra. */
  descartou: -2,
  /** Passou antes de ver qualquer coisa: reflexo de rolagem, quase neutro. */
  descartouNoReflexo: -0.5,
} as const;

/**
 * Tempo assistido vira peso por logaritmo: os primeiros minutos dizem muito
 * ("ficou"), os seguintes dizem cada vez menos ("continua ficando"). Sem a
 * compressão, uma única maratona de três horas apagaria todo o resto.
 *
 * 2 min → 3 · 10 min → 7,8 · 40 min → 13,2 · 3 h → 19,7
 */
export const PESO_POR_TEMPO = 3;

/** Metade do peso a cada duas semanas. Gosto muda; o log não deve fingir que não. */
export const MEIA_VIDA_DIAS = 14;

/** Bônus máximo do que aconteceu agora há pouco, somado ao peso normal. */
export const BONUS_DO_MOMENTO = 0.8;
/** Metade do bônus do momento a cada três horas. */
export const MEIA_VIDA_MOMENTO_HORAS = 3;

/** Abaixo disto, o descarte é reflexo de rolagem, não decisão. */
export const DESCARTE_REFLEXO_MS = 700;
/** Descartes decididos a partir dos quais a obra sai da descoberta. */
export const DESCARTES_PARA_RECUSAR = 2;
/** Por quanto tempo uma recusa vale. Depois disso a obra pode voltar. */
export const RECUSA_VALE_DIAS = 21;

/**
 * Força mínima para o perfil mandar na ordem.
 *
 * Abaixo disso a pessoa é nova demais — dois toques não são um gosto, e tratar
 * como se fossem prenderia alguém num canto do catálogo por causa de um
 * acidente. Até chegar lá, quem ordena é o que está em alta.
 */
export const FORCA_MINIMA = 8;

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

export function decaimento(quando: Date, agora: number): number {
  const dias = (agora - quando.getTime()) / DIA_MS;
  return Math.pow(0.5, Math.max(0, dias) / MEIA_VIDA_DIAS);
}

/** 1 para o que é antigo; até 1 + BONUS_DO_MOMENTO para o que é de agora. */
export function momento(quando: Date, agora: number): number {
  const horas = Math.max(0, agora - quando.getTime()) / HORA_MS;
  return 1 + BONUS_DO_MOMENTO * Math.pow(0.5, horas / MEIA_VIDA_MOMENTO_HORAS);
}

export function pesoDoTempo(minutos: number): number {
  return minutos <= 0 ? 0 : PESO_POR_TEMPO * Math.log2(1 + minutos / 2);
}

/**
 * Quanto vale um descarte.
 *
 * `ms` é o tempo que a lâmina ficou em cena. Sem ele (eventos antigos), vale
 * como decisão — era a regra de antes, e é a leitura conservadora.
 */
export function pesoDoDescarte(ms: number | null): number {
  if (ms !== null && ms < DESCARTE_REFLEXO_MS) return PESO.descartouNoReflexo;
  return PESO.descartou;
}

// ---------------------------------------------------------------- corpus

export type Corpus = {
  /** Termos de cada novela, já reduzidos aos mais discriminativos. */
  porNovela: Map<string, string[]>;
  /** Raridade de cada termo: quanto mais raro, mais ele diz. */
  idf: Map<string, number>;
  /** Gêneros de cada novela. Vazio enquanto o catálogo não for classificado. */
  generos: Map<string, string[]>;
};

// ---------------------------------------------------------------- perfil

export type PerfilDeGosto = {
  /** Peso por termo, já decaído no tempo e ponderado por raridade. */
  termos: Map<string, number>;
  /** Peso por gênero. Fica vazio enquanto o catálogo não tiver classificação. */
  generos: Map<string, number>;
  /** Novelas com algum engajamento — não repetem como descoberta. */
  engajadas: Set<string>;
  /** Novelas descartadas de propósito, recentemente: a pessoa já disse não. */
  recusadas: Set<string>;
  /** Soma dos pesos positivos. Abaixo de um mínimo, o perfil não decide nada. */
  forca: number;
};

export type TipoDeEvento =
  | "REEL_SLIDE_VIEW"
  | "REEL_SLIDE_SKIP"
  | "EPISODE_COMMENT"
  | "EPISODE_SHARE"
  | "NOVELA_VIEW";

/** Os fatos de uma pessoa, já lidos do banco. */
export type FatosDoEspectador = {
  progresso: { novelaId: string; percent: number; completed: boolean; quando: Date }[];
  favoritos: { novelaId: string; quando: Date }[];
  curtidas: { novelaId: string; quando: Date }[];
  eventos: { tipo: TipoDeEvento; novelaId: string; quando: Date; valorMs: number | null }[];
  /** Tempo assistido agregado por novela e hora. */
  tempo: { novelaId: string; quando: Date; ms: number }[];
};

const PESO_DO_EVENTO: Record<Exclude<TipoDeEvento, "REEL_SLIDE_SKIP">, number> = {
  REEL_SLIDE_VIEW: PESO.permaneceu,
  EPISODE_COMMENT: PESO.comentou,
  EPISODE_SHARE: PESO.enviou,
  NOVELA_VIEW: PESO.abriu,
};

/**
 * Monta o perfil.
 *
 * Tudo é reconstruível: cada peso vem de um fato datado. Não há estado de
 * recomendação guardado — o perfil é recalculado, e por isso nunca fica
 * dessincronizado de um fato que foi apagado.
 */
export function montarPerfil(
  fatos: FatosDoEspectador,
  corpus: Corpus,
  agora: number,
): PerfilDeGosto {
  const porNovela = new Map<string, number>();
  const somar = (novelaId: string, valor: number) =>
    porNovela.set(novelaId, (porNovela.get(novelaId) ?? 0) + valor);
  const tempoDecaido = (quando: Date) =>
    decaimento(quando, agora) * momento(quando, agora);

  // Tempo assistido: os minutos de cada novela são somados já descontados no
  // tempo, e só então comprimidos. Comprimir linha a linha faria vinte sessões
  // curtas valerem mais que uma longa com o mesmo total.
  const minutos = new Map<string, number>();
  for (const t of fatos.tempo) {
    minutos.set(
      t.novelaId,
      (minutos.get(t.novelaId) ?? 0) + (t.ms / 60_000) * tempoDecaido(t.quando),
    );
  }
  for (const [novelaId, m] of minutos) somar(novelaId, pesoDoTempo(m));

  for (const linha of fatos.progresso) {
    const peso = linha.completed
      ? PESO.concluiu
      : linha.percent >= 40 && !minutos.has(linha.novelaId)
        ? PESO.assistiuBastante
        : 0;
    if (peso > 0) somar(linha.novelaId, peso * tempoDecaido(linha.quando));
  }

  for (const f of fatos.favoritos) {
    somar(f.novelaId, PESO.favoritou * tempoDecaido(f.quando));
  }
  for (const c of fatos.curtidas) {
    somar(c.novelaId, PESO.curtiu * tempoDecaido(c.quando));
  }

  const descartesRecentes = new Map<string, number>();
  const limiteDaRecusa = agora - RECUSA_VALE_DIAS * DIA_MS;
  for (const e of fatos.eventos) {
    if (e.tipo === "REEL_SLIDE_SKIP") {
      const peso = pesoDoDescarte(e.valorMs);
      // O descarte não ganha bônus de momento: ele diz "esta obra, não", e
      // amplificá-lo por ser recente puniria em dobro quem rola rápido.
      somar(e.novelaId, peso * decaimento(e.quando, agora));
      if (peso === PESO.descartou && e.quando.getTime() >= limiteDaRecusa) {
        descartesRecentes.set(e.novelaId, (descartesRecentes.get(e.novelaId) ?? 0) + 1);
      }
      continue;
    }
    somar(e.novelaId, PESO_DO_EVENTO[e.tipo] * tempoDecaido(e.quando));
  }

  const termos = new Map<string, number>();
  const generos = new Map<string, number>();
  const engajadas = new Set<string>();
  let forca = 0;

  for (const [novelaId, peso] of porNovela) {
    if (peso > 0) engajadas.add(novelaId);
    // Peso negativo não empurra termos para baixo. Um descarte diz "esta
    // obra, não" — e é assim que ele é usado, na lista de recusadas. Deixá-lo
    // subtrair termos faria uma passada de dedo numa novela de vingança
    // derrubar *todas* as de vingança, inclusive as que a pessoa terminou.
    if (peso <= 0) continue;
    forca += peso;

    for (const termo of corpus.porNovela.get(novelaId) ?? []) {
      const raridade = corpus.idf.get(termo) ?? 0;
      termos.set(termo, (termos.get(termo) ?? 0) + peso * raridade);
    }
    for (const generoId of corpus.generos.get(novelaId) ?? []) {
      generos.set(generoId, (generos.get(generoId) ?? 0) + peso);
    }
  }

  // Descartar uma obra que já foi assistida não é rejeição: é ter passado por
  // um episódio já visto.
  const recusadas = new Set(
    [...descartesRecentes]
      .filter(([novelaId, n]) => n >= DESCARTES_PARA_RECUSAR && (porNovela.get(novelaId) ?? 0) <= 0)
      .map(([novelaId]) => novelaId),
  );

  return { termos, generos, engajadas, recusadas, forca };
}

// ------------------------------------------------------------ pontuação

export type Pontuacao = {
  valor: number;
  /** Por que esta obra subiu. Alimenta o painel e a depuração, nunca a tela. */
  motivo: "gosto" | "popular";
};

/**
 * Pontua uma novela contra o perfil.
 *
 * A soma dos termos é dividida pela raiz do número de termos, e não pelo
 * número: sem alguma normalização, sinopses longas ganham sempre; com a
 * divisão inteira, obras específicas demais somem. A raiz é o meio-termo
 * conhecido desse problema.
 *
 * `popularidade` é a pontuação de tendência (`pontuarTendencia`), não um
 * contador de visualizações.
 */
export function pontuar(
  novelaId: string,
  perfil: PerfilDeGosto,
  corpus: Corpus,
  contexto: { popularidade: number },
): Pontuacao {
  const termos = corpus.porNovela.get(novelaId) ?? [];
  let soma = 0;
  for (const termo of termos) {
    soma += perfil.termos.get(termo) ?? 0;
  }
  const afinidadeDeTexto = termos.length > 0 ? soma / Math.sqrt(termos.length) : 0;

  let afinidadeDeGenero = 0;
  for (const generoId of corpus.generos.get(novelaId) ?? []) {
    afinidadeDeGenero += perfil.generos.get(generoId) ?? 0;
  }

  // A popularidade entra com peso pequeno: ela é o desempate entre obras que
  // o perfil não distingue, não o critério.
  const prior = Math.max(0, contexto.popularidade) * 0.35;
  const valor = afinidadeDeTexto + afinidadeDeGenero * 1.5 + prior;

  return {
    valor,
    motivo: afinidadeDeTexto + afinidadeDeGenero > prior ? "gosto" : "popular",
  };
}

// ------------------------------------------------------------ tendência

/** O que o catálogo mostrou nos últimos dias, por novela. */
export type FatosDeTendencia = {
  /** Minutos assistidos, cada um descontado pela idade (meia-vida curta). */
  minutosRecentes: number;
  /** Pessoas distintas que assistiram no período. */
  espectadores: number;
  /** Lâminas de abertura em que alguém ficou. */
  ficaram: number;
  /** Lâminas de abertura que alguém viu e passou. */
  passaram: number;
  /** Visualizações de sempre — só desempata quem não tem sinal recente. */
  visualizacoesDeSempre: number;
};

export type Tendencia = {
  valor: number;
  /** Houve tempo assistido de verdade no período. Só esses ganham ranking. */
  assistidaAgora: boolean;
};

/**
 * Quanto uma novela está em alta.
 *
 * Três perguntas, nesta ordem de peso:
 *
 * 1. **Estão assistindo agora?** Minutos recentes, comprimidos por logaritmo.
 * 2. **Quantas pessoas?** Uma pessoa maratonando conta menos que cinco
 *    assistindo um pouco — "em alta" é sobre muita gente, não muito tempo.
 * 3. **O começo segura?** Das pessoas que viram a abertura, quantas ficaram.
 *    Com poucos dados isso é ruído, então a taxa é puxada para uma média
 *    prévia (60%) até ter volume para falar sozinha.
 *
 * O histórico de sempre entra com peso mínimo, só para dar ordem a quem não
 * tem sinal nenhum no período — senão metade do catálogo empataria no zero.
 */
export function pontuarTendencia(f: FatosDeTendencia): Tendencia {
  const TAXA_PREVIA = 0.6;
  const PESO_DA_PREVIA = 4;
  const segura =
    (f.ficaram + TAXA_PREVIA * PESO_DA_PREVIA) /
    (f.ficaram + f.passaram + PESO_DA_PREVIA);

  const atual =
    Math.log1p(Math.max(0, f.minutosRecentes)) *
    (1 + 0.5 * Math.log1p(Math.max(0, f.espectadores - 1))) *
    (0.5 + segura);

  const historico = 0.1 * Math.log1p(Math.max(0, f.visualizacoesDeSempre));

  return {
    valor: atual + historico,
    assistidaAgora: f.minutosRecentes >= 1,
  };
}
