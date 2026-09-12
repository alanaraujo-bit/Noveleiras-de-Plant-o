import "server-only";

import { cache } from "react";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { normalizeText } from "@/lib/text";
import {
  montarPerfil,
  type Corpus,
  type PerfilDeGosto,
  type TipoDeEvento,
} from "@/lib/recomendacao/sinais";

export {
  FORCA_MINIMA,
  pontuar,
  type Corpus,
  type PerfilDeGosto,
  type Pontuacao,
} from "@/lib/recomendacao/sinais";

/**
 * Perfil de gosto — a parte que lê o banco.
 *
 * O que cada fato vale mora em `lib/recomendacao/sinais`, que é puro e
 * testado. Aqui só se decide **quais** fatos ler e como trazê-los baratos.
 *
 * ## Por que o espaço de features é o texto, e não o gênero
 *
 * Recomendar exige generalizar de uma obra para outra: se gostou desta, quais
 * se parecem com ela? O caminho natural seria o gênero. Ele ainda não existe no
 * dado: as novelas importadas chegam com `NovelaGenre` e `tags` vazios, porque
 * a origem (ReelShort) não publica temas. Um recomendador só por gênero
 * classificaria tudo com afinidade zero e devolveria popularidade com outro
 * nome.
 *
 * O que existe é `searchText` — título e sinopse normalizados. Então a
 * semelhança sai dos termos da sinopse, ponderados por raridade (IDF):
 * "vinganca" e "alcateia" dizem algo sobre a obra; "que" e "ela" não dizem
 * nada.
 *
 * O gênero continua somando quando existir. No dia em que a ingestão passar a
 * classificar o catálogo, este arquivo aproveita sem mudar de forma.
 *
 * ## O que este arquivo deliberadamente não faz
 *
 * Não há filtragem colaborativa ("quem viu isto também viu aquilo"). Ela
 * precisa de muitos espectadores para sair do ruído, e a base tem poucas
 * contas. Prometer isso agora seria inventar sinal.
 */

/** Termos por novela que entram no perfil. Além disso vira ruído de sinopse. */
const TERMOS_POR_NOVELA = 12;

/**
 * Janela de leitura. Com meia-vida de 14 dias, o que passa de 90 vale menos de
 * 1% — ler além disso seria carregar linhas que não mudam nada.
 */
const JANELA_DIAS = 90;

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

/**
 * Vocabulário do catálogo, memoizado por requisição.
 *
 * Uma consulta que lê as sinopses do catálogo é barata; repeti-la para cada
 * lâmina de uma fila não seria. `cache` do React resolve isso no escopo certo —
 * a mesma fronteira que `getViewer` já usa.
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

const EVENTOS_DO_PERFIL: TipoDeEvento[] = [
  "REEL_SLIDE_VIEW",
  "REEL_SLIDE_SKIP",
  "EPISODE_COMMENT",
  "EPISODE_SHARE",
  "NOVELA_VIEW",
];

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
    const desde = new Date(agora - JANELA_DIAS * 86_400_000);

    const [progresso, favoritos, curtidas, eventos, tempo, corpus] =
      await Promise.all([
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
            type: { in: EVENTOS_DO_PERFIL },
          },
          select: { type: true, novelaId: true, createdAt: true, valueMs: true },
        }),
        // Tempo assistido: um evento a cada dez segundos de reprodução. Somado
        // por hora no banco — são milhares de linhas por pessoa ativa, e o
        // perfil só precisa saber quanto foi assistido e mais ou menos quando.
        db.$queryRaw<{ novelaId: string; hora: Date; ms: number }[]>(Prisma.sql`
          SELECT
            e."novelaId"                         AS "novelaId",
            date_trunc('hour', e."createdAt")    AS "hora",
            sum(e."valueMs")::float8             AS "ms"
          FROM "Event" e
          WHERE e."userId" = ${userId}
            AND e."createdAt" >= ${desde}
            AND e."type"::text = 'PLAY_PROGRESS'
            AND e."novelaId" IS NOT NULL
            AND e."valueMs" > 0
          GROUP BY e."novelaId", date_trunc('hour', e."createdAt")
        `),
        corpusDoCatalogo(),
      ]);

    return montarPerfil(
      {
        progresso: progresso.map((p) => ({
          novelaId: p.novelaId,
          percent: p.percent,
          completed: p.completed,
          quando: p.updatedAt,
        })),
        favoritos: favoritos.map((f) => ({ novelaId: f.novelaId, quando: f.createdAt })),
        curtidas: curtidas.map((c) => ({
          novelaId: c.episode.novelaId,
          quando: c.createdAt,
        })),
        eventos: eventos.flatMap((e) =>
          e.novelaId
            ? [
                {
                  tipo: e.type as TipoDeEvento,
                  novelaId: e.novelaId,
                  quando: e.createdAt,
                  valorMs: e.valueMs,
                },
              ]
            : [],
        ),
        // O banco devolve a hora como timestamp sem fuso, já em UTC.
        tempo: tempo.map((t) => ({ novelaId: t.novelaId, quando: t.hora, ms: t.ms })),
      },
      corpus,
      agora,
    );
  },
);
