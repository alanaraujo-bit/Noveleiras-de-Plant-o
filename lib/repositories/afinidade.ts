import "server-only";

import { cache } from "react";

import { db } from "@/lib/db";
import { normalizeText } from "@/lib/text";

/**
 * Perfil de gosto.
 *
 * O que a pessoa gosta é **derivado do que ela fez**, nunca do que ela disse.
 * Terminar um episódio, curtir, comentar, enviar e favoritar são fatos
 * datados; passar o dedo em dois segundos também é. O perfil é a soma desses
 * fatos com peso e prazo de validade — e nada mais.
 *
 * ## Por que o espaço de features é o texto, e não o gênero
 *
 * Recomendar exige generalizar de uma obra para outra: se gostou desta, quais
 * se parecem com ela? O caminho natural seria o gênero. Ele não existe no
 * dado: as 141 novelas do catálogo estão com `NovelaGenre` vazio e `tags`
 * vazio. Um recomendador por gênero classificaria tudo com afinidade zero e
 * devolveria a ordem de popularidade com outro nome.
 *
 * O que existe é `searchText` — título e sinopse normalizados, preenchidos
 * para as 141. Então a semelhança sai dos termos da sinopse, ponderados por
 * raridade (IDF): "vinganca" e "alcateia" dizem algo sobre a obra; "que" e
 * "ela" não dizem nada.
 *
 * O gênero continua somando quando existir. No dia em que a ingestão passar a
 * classificar o catálogo, este arquivo aproveita sem mudar de forma — é por
 * isso que os dois sinais são computados lado a lado em vez de um substituir
 * o outro.
 *
 * ## O que este arquivo deliberadamente não faz
 *
 * Não há filtragem colaborativa ("quem viu isto também viu aquilo"). Ela
 * precisa de muitos espectadores para sair do ruído, e a base tem quatro
 * contas. Prometer isso agora seria inventar sinal.
 */

// ---------------------------------------------------------------- pesos
//
// A escala é grosseira de propósito: a diferença entre "assistiu até o fim" e
// "passou o dedo" precisa ser óbvia, e afinar decimais sem base de usuários
// para medir seria fingir precisão.

const PESO = {
  /** Assistiu até o fim. O sinal mais forte que existe sem pedir nada. */
  concluiu: 5,
  /** Passou de 40% do episódio: ficou de verdade, mesmo sem terminar. */
  assistiuBastante: 2.5,
  favoritou: 6,
  curtiu: 4,
  comentou: 5,
  enviou: 5,
  /** Ficou numa lâmina além do limiar de permanência. */
  permaneceu: 1,
  /** Abriu a ficha da novela: interesse declarado por um toque. */
  abriu: 0.5,
  /**
   * Descartou a lâmina antes do limiar. Negativo, e mais fraco em módulo que
   * os positivos: um descarte pode ser "não agora", enquanto terminar um
   * episódio nunca é acidente.
   */
  descartou: -2,
} as const;

/** Metade do peso a cada duas semanas. Gosto muda; o log não deve fingir que não. */
const MEIA_VIDA_DIAS = 14;

/** Termos por novela que entram no perfil. Além disso vira ruído de sinopse. */
const TERMOS_POR_NOVELA = 12;

/** Descartes rápidos a partir dos quais a obra é considerada recusada. */
const DESCARTES_PARA_RECUSAR = 2;

function decaimento(quando: Date, agora: number): number {
  const dias = (agora - quando.getTime()) / 86_400_000;
  return Math.pow(0.5, Math.max(0, dias) / MEIA_VIDA_DIAS);
}

// ----------------------------------------------------------- vocabulário

/**
 * Palavras que aparecem em quase toda sinopse e não distinguem nada.
 *
 * A lista cobre o português estrutural — artigos, preposições, verbos de
 * ligação, pronomes. Não inclui palavras de enredo ("amor", "vinganca"),
 * porque essas são exatamente o que o perfil precisa capturar.
 */
const VAZIAS = new Set(
  ("a o e de da do das dos em no na nos nas um uma uns umas para por com sem" +
    " que se como mas mais menos muito muita ao aos as os pelo pela pelos pelas" +
    " seu sua seus suas dele dela deles delas ele ela eles elas eu voce nos" +
    " lhe lhes me te nao sim ja entao quando onde quem qual quais cujo cuja" +
    " este esta estes estas esse essa esses essas aquele aquela aqueles aquelas" +
    " isso isto aquilo ser estar ter haver foi era sao esta estao tem tinha" +
    " sera seria fica ficou vai vem apos antes depois ate desde entre sobre" +
    " sob contra durante mesmo mesma outros outras todo toda todos todas" +
    " cada qualquer nada tudo agora hoje ontem amanha aqui ali la so apenas" +
    " tambem ainda porque pois entao assim depois dois duas tres anos ano" +
    " vez vezes dia dias noite vida homem mulher").split(/\s+/),
);

/** Termos discriminativos de um texto. Palavras curtas e vazias caem fora. */
function termosDe(texto: string): string[] {
  return normalizeText(texto)
    .split(" ")
    .filter((t) => t.length >= 4 && !VAZIAS.has(t));
}

export type Corpus = {
  /** Termos de cada novela, já reduzidos aos mais discriminativos. */
  porNovela: Map<string, string[]>;
  /** Raridade de cada termo: quanto mais raro, mais ele diz. */
  idf: Map<string, number>;
  /** Gêneros de cada novela. Vazio enquanto o catálogo não for classificado. */
  generos: Map<string, string[]>;
};

/**
 * Vocabulário do catálogo, memoizado por requisição.
 *
 * Uma consulta que lê 141 sinopses é barata; repeti-la para cada lâmina de uma
 * fila não seria. `cache` do React resolve isso no escopo certo — a mesma
 * fronteira que `getViewer` já usa.
 *
 * Se o catálogo crescer uma ordem de grandeza, o caminho é materializar o IDF
 * numa tabela e reler daqui; nenhuma outra parte deste arquivo muda.
 */
export const corpusDoCatalogo = cache(async (): Promise<Corpus> => {
  const novelas = await db.novela.findMany({
    where: { status: { not: "COMING_SOON" } },
    select: {
      id: true,
      searchText: true,
      title: true,
      synopsis: true,
      genres: { select: { genreId: true } },
    },
  });

  const porNovela = new Map<string, string[]>();
  const generos = new Map<string, string[]>();
  const documentosComTermo = new Map<string, number>();

  for (const novela of novelas) {
    // `searchText` é o campo oficial de busca e já concentra título, sinopse,
    // elenco e tags. Título e sinopse entram como reserva para linhas antigas
    // gravadas antes de ele existir.
    const base =
      novela.searchText.trim() || `${novela.title} ${novela.synopsis}`;

    const frequencia = new Map<string, number>();
    for (const termo of termosDe(base)) {
      frequencia.set(termo, (frequencia.get(termo) ?? 0) + 1);
    }

    // Os mais frequentes dentro da obra, cortados no teto: uma sinopse longa
    // não pode pesar mais no perfil só por ser longa.
    const escolhidos = [...frequencia.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TERMOS_POR_NOVELA)
      .map(([termo]) => termo);

    porNovela.set(novela.id, escolhidos);
    generos.set(
      novela.id,
      novela.genres.map((g) => g.genreId),
    );
    for (const termo of new Set(escolhidos)) {
      documentosComTermo.set(termo, (documentosComTermo.get(termo) ?? 0) + 1);
    }
  }

  // IDF suavizado. Um termo presente em quase todas as obras tende a zero; um
  // que aparece em duas ou três carrega quase todo o peso.
  //
  // Termos de uma obra só ficam de fora, e não por economia: eles **não podem**
  // aproximar duas novelas, porque só existem numa. Mantê-los daria ao perfil
  // um punhado de palavras com o peso máximo do vocabulário — "trilionario",
  // "mimados" — que nunca casariam com nada. O perfil pareceria mais preciso e
  // recomendaria pior.
  const total = Math.max(1, novelas.length);
  const idf = new Map<string, number>();
  for (const [termo, documentos] of documentosComTermo) {
    if (documentos < 2) continue;
    idf.set(termo, Math.log(1 + total / (1 + documentos)));
  }

  // Os termos de cada obra são reduzidos ao vocabulário que generaliza. Uma
  // novela pode acabar sem termo nenhum — a sinopse é toda de palavras únicas
  // — e nesse caso ela simplesmente não participa do casamento por texto, em
  // vez de participar com ruído.
  for (const [novelaId, termos] of porNovela) {
    porNovela.set(
      novelaId,
      termos.filter((t) => idf.has(t)),
    );
  }

  return { porNovela, idf, generos };
});

// -------------------------------------------------------------- perfil

export type PerfilDeGosto = {
  /** Peso por termo, já decaído no tempo e ponderado por raridade. */
  termos: Map<string, number>;
  /** Peso por gênero. Fica vazio enquanto o catálogo não tiver classificação. */
  generos: Map<string, number>;
  /** Novelas com algum engajamento — não repetem como descoberta. */
  engajadas: Set<string>;
  /** Novelas descartadas rápido mais de uma vez: a pessoa já disse não. */
  recusadas: Set<string>;
  /** Soma dos pesos positivos. Abaixo de um mínimo, o perfil não decide nada. */
  forca: number;
};

/** Sinal cru: uma novela, um peso e a data em que aconteceu. */
type Sinal = { novelaId: string; peso: number; quando: Date };

/**
 * Monta o perfil a partir do log e do progresso.
 *
 * Tudo aqui é reconstruível: cada peso vem de uma linha datada em `Event`,
 * `WatchProgress`, `Favorite` ou `EpisodeLike`. Não há estado de recomendação
 * guardado em lugar nenhum — o perfil é recalculado, e por isso nunca fica
 * dessincronizado de um fato que foi apagado.
 */
export const perfilDeGosto = cache(
  async (userId: string): Promise<PerfilDeGosto> => {
    const agora = Date.now();
    // Uma janela de 90 dias com meia-vida de 14 já deixa o mais antigo valendo
    // menos de 1% — ler além disso seria carregar linhas que não mudam nada.
    const desde = new Date(agora - 90 * 86_400_000);

    const [progresso, favoritos, curtidas, eventos] = await Promise.all([
      db.watchProgress.findMany({
        where: { userId, updatedAt: { gte: desde } },
        select: {
          novelaId: true,
          percent: true,
          completed: true,
          updatedAt: true,
        },
      }),
      db.favorite.findMany({
        where: { userId, createdAt: { gte: desde } },
        select: { novelaId: true, createdAt: true },
      }),
      db.episodeLike.findMany({
        where: { userId, createdAt: { gte: desde } },
        select: { createdAt: true, episode: { select: { novelaId: true } } },
      }),
      db.event.findMany({
        where: {
          userId,
          createdAt: { gte: desde },
          novelaId: { not: null },
          type: {
            in: [
              "REEL_SLIDE_VIEW",
              "REEL_SLIDE_SKIP",
              "EPISODE_COMMENT",
              "EPISODE_SHARE",
              "NOVELA_VIEW",
            ],
          },
        },
        select: { type: true, novelaId: true, createdAt: true },
      }),
    ]);

    const sinais: Sinal[] = [];
    const descartes = new Map<string, number>();

    for (const linha of progresso) {
      const peso = linha.completed
        ? PESO.concluiu
        : linha.percent >= 40
          ? PESO.assistiuBastante
          : 0;
      if (peso > 0) {
        sinais.push({
          novelaId: linha.novelaId,
          peso,
          quando: linha.updatedAt,
        });
      }
    }

    for (const f of favoritos) {
      sinais.push({
        novelaId: f.novelaId,
        peso: PESO.favoritou,
        quando: f.createdAt,
      });
    }

    for (const c of curtidas) {
      sinais.push({
        novelaId: c.episode.novelaId,
        peso: PESO.curtiu,
        quando: c.createdAt,
      });
    }

    for (const e of eventos) {
      if (!e.novelaId) continue;
      const peso =
        e.type === "REEL_SLIDE_VIEW"
          ? PESO.permaneceu
          : e.type === "REEL_SLIDE_SKIP"
            ? PESO.descartou
            : e.type === "EPISODE_COMMENT"
              ? PESO.comentou
              : e.type === "EPISODE_SHARE"
                ? PESO.enviou
                : PESO.abriu;

      if (e.type === "REEL_SLIDE_SKIP") {
        descartes.set(e.novelaId, (descartes.get(e.novelaId) ?? 0) + 1);
      }
      sinais.push({ novelaId: e.novelaId, peso, quando: e.createdAt });
    }

    // Peso final por novela, com o tempo já descontado.
    const porNovela = new Map<string, number>();
    for (const s of sinais) {
      const valor = s.peso * decaimento(s.quando, agora);
      porNovela.set(s.novelaId, (porNovela.get(s.novelaId) ?? 0) + valor);
    }

    const corpus = await corpusDoCatalogo();
    const termos = new Map<string, number>();
    const generos = new Map<string, number>();
    const engajadas = new Set<string>();
    let forca = 0;

    for (const [novelaId, peso] of porNovela) {
      if (peso > 0) engajadas.add(novelaId);
      // Peso negativo não empurra termos para baixo.
      //
      // Um descarte diz "esta obra, não" — e é assim que ele é usado, na lista
      // de recusadas. Deixá-lo subtrair termos faria uma passada de dedo numa
      // novela de vingança derrubar *todas* as de vingança, inclusive as que a
      // pessoa terminou. O sinal negativo é sobre a obra, não sobre o gosto.
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

    const recusadas = new Set(
      [...descartes.entries()]
        .filter(([novelaId, n]) => {
          // Descartar uma obra que já foi assistida não é rejeição: é ter
          // passado por um episódio já visto.
          if (n < DESCARTES_PARA_RECUSAR) return false;
          return (porNovela.get(novelaId) ?? 0) <= 0;
        })
        .map(([novelaId]) => novelaId),
    );

    return { termos, generos, engajadas, recusadas, forca };
  },
);

// ------------------------------------------------------------ pontuação

/**
 * Força mínima para o perfil mandar na ordem.
 *
 * Abaixo disso a pessoa é nova demais — dois toques não são um gosto, e tratar
 * como se fossem prenderia alguém num canto do catálogo por causa de um
 * acidente. Até chegar lá, quem ordena é a preferência declarada no onboarding
 * e a popularidade.
 */
export const FORCA_MINIMA = 8;

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
  const afinidadeDeTexto =
    termos.length > 0 ? soma / Math.sqrt(termos.length) : 0;

  const generosDaNovela = corpus.generos.get(novelaId) ?? [];
  let afinidadeDeGenero = 0;
  for (const generoId of generosDaNovela) {
    afinidadeDeGenero += perfil.generos.get(generoId) ?? 0;
  }

  // A popularidade entra comprimida por logaritmo e com peso pequeno: ela é o
  // desempate entre obras que o perfil não distingue, não o critério.
  const prior = Math.log1p(Math.max(0, contexto.popularidade)) * 0.35;

  const valor =
    afinidadeDeTexto + afinidadeDeGenero * 1.5 + prior;

  return {
    valor,
    motivo:
      afinidadeDeTexto + afinidadeDeGenero > prior
        ? "gosto"
        : "popular",
  };
}
