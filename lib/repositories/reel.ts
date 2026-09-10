import "server-only";

import { db } from "@/lib/db";
import { posterUrl, resolveMedia, type MediaProviderName } from "@/lib/media/resolver";
import { assinarUrl, segredoDeMidia } from "@/lib/media/assinatura";
import { canWatchEpisode, type Entitlement } from "@/lib/access/entitlements";
import { filtroDeComentariosVisiveis } from "@/lib/repositories/episodio-social";
import type { Fonte } from "@/lib/player/reproducao";

/**
 * Fila do reel.
 *
 * O modelo mental é uma **emenda**, não um embaralhamento. Noveleiras exibe
 * folhetim: uma novela tem ordem, e perder a ordem é perder a história. Então
 * a fila alterna entre dois regimes explícitos:
 *
 * - `serie`  — episódios seguintes da mesma novela, na ordem. É o que mantém
 *              a pessoa dentro da narrativa em que ela já investiu tempo.
 * - `gancho` — episódio de abertura de uma novela que a pessoa ainda não viu.
 *              É o que faz a fila não acabar e o catálogo ser descoberto.
 *
 * A fila abre em `serie` quando existe algo pendente, e emenda ganchos depois.
 * Quando a pessoa para num gancho e fica, o cliente pede a continuação daquela
 * novela por `/api/reel` e ela é costurada logo abaixo — a passagem de
 * "descobri" para "estou assistindo" acontece sem tela intermediária.
 *
 * Nada aqui inventa relevância: a ordenação usa gênero preferido declarado no
 * onboarding, destaque editorial e contagem de acessos já gravada.
 */

/** Episódios da novela em andamento que entram de uma vez. */
const LOTE_SERIE = 4;
/** Ganchos por página da fila. */
const LOTE_GANCHOS = 8;
/** Novelas distintas no bloco de continuação. Mais que isso vira lista, não fila. */
const NOVELAS_EM_ANDAMENTO = 2;

export type OrigemDaLamina = "serie" | "gancho";

export type LaminaReel = {
  /** Único na fila. Um mesmo episódio nunca aparece duas vezes numa sessão. */
  chave: string;
  origem: OrigemDaLamina;
  episodio: {
    id: string;
    numero: number;
    temporada: number;
    titulo: string;
    sinopse: string;
    /** Frase de abertura. Cai para a sinopse quando não há gancho escrito. */
    gancho: string;
    duracaoSec: number;
    capaUrl: string;
    /** Posição absoluta na novela e total — alimenta "Ep 4 de 20". */
    posicao: number;
    total: number;
  };
  novela: {
    id: string;
    slug: string;
    titulo: string;
    accent: string;
    posterUrl: string;
    tags: string[];
    ageRating: string;
  };
  fonte: Fonte | null;
  bloqueio: "precisa-conta" | "precisa-pagar" | null;
  /** Segundos de onde retomar. Zero quando a pessoa nunca abriu ou concluiu. */
  retomarEm: number;
  social: {
    curtidas: number;
    comentarios: number;
    envios: number;
    curtido: boolean;
  };
};

type EpisodioCru = {
  id: string;
  number: number;
  title: string;
  synopsis: string;
  hookText: string | null;
  durationSec: number;
  mediaKey: string;
  mediaProvider: string;
  mediaFormat: string;
  thumbKey: string;
  likeCount: number;
  shareCount: number;
  season: { number: number };
  _count: { comments: number };
};

type NovelaCrua = {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  synopsis: string;
  accent: string;
  posterKey: string;
  tags: string[];
  ageRating: string;
  openAccess: boolean;
};

const EPISODIO_SELECT = {
  id: true,
  number: true,
  title: true,
  synopsis: true,
  hookText: true,
  durationSec: true,
  mediaKey: true,
  mediaProvider: true,
  mediaFormat: true,
  thumbKey: true,
  likeCount: true,
  shareCount: true,
  season: { select: { number: true } },
  // A contagem sai da relação, e não da coluna espelho: comentário agora tem
  // resposta, e apagar uma raiz leva a árvore em cascata — nenhum decremento
  // acompanharia isso sem errar. Uma subconsulta por lâmina, exata sempre.
  _count: { select: { comments: { where: filtroDeComentariosVisiveis() } } },
} as const;

const NOVELA_SELECT = {
  id: true,
  slug: true,
  title: true,
  tagline: true,
  synopsis: true,
  accent: true,
  posterKey: true,
  tags: true,
  ageRating: true,
  openAccess: true,
} as const;

/**
 * Monta uma lâmina.
 *
 * A fonte é assinada aqui, junto com o HTML, pelo mesmo motivo do player de
 * tela cheia: a lâmina precisa abrir tocando. Uma ida à rede antes do primeiro
 * quadro é exatamente a diferença entre um reel e um site de vídeo.
 */
function montarLamina({
  episodio,
  novela,
  origem,
  posicao,
  total,
  entitlement,
  viewerId,
  retomarEm,
  curtido,
}: {
  episodio: EpisodioCru;
  novela: NovelaCrua;
  origem: OrigemDaLamina;
  posicao: number;
  total: number;
  entitlement: Entitlement;
  viewerId: string | null;
  retomarEm: number;
  curtido: boolean;
}): LaminaReel {
  const decisao = canWatchEpisode(
    {
      novelaId: novela.id,
      episodeIndex: posicao,
      openAccess: novela.openAccess,
    },
    entitlement,
    Boolean(viewerId),
  );

  let fonte: Fonte | null = null;
  if (decisao.allowed) {
    const bruta = resolveMedia({
      mediaKey: episodio.mediaKey,
      provider: episodio.mediaProvider as MediaProviderName,
      format: episodio.mediaFormat,
      thumbKey: episodio.thumbKey,
      durationSec: episodio.durationSec,
    });
    const assinada = viewerId
      ? assinarUrl(bruta.url, episodio.mediaKey, viewerId, segredoDeMidia())
      : { url: bruta.url, expiraEm: null };
    fonte = {
      kind: bruta.kind,
      url: assinada.url,
      poster: bruta.poster,
      expiresAt: assinada.expiraEm?.toISOString() ?? null,
    };
  }

  // Cadeia de queda do gancho.
  //
  // Texto próprio do episódio — gancho escrito ou sinopse — vale sempre: ele
  // fala do que está na tela.
  //
  // A sinopse da **novela** é outra coisa. Ela apresenta a obra, e apresentar
  // a obra só faz sentido em quem ainda não a conhece: na abertura. Repetida
  // no episódio 40, ela conta de novo um começo que a pessoa já viu, e ocupa
  // duas linhas sobre a cena dizendo nada de novo. Fica, portanto, restrita à
  // primeira posição.
  //
  // A consequência é deliberada e visível: enquanto a ingestão não escrever
  // sinopse por episódio — hoje os 8.899 estão vazios —, do segundo em diante
  // a lâmina fica sem texto. É o resultado correto. Uma linha que não descreve
  // o episódio é pior do que nenhuma, porque parece informação.
  const textoDoEpisodio =
    episodio.hookText?.trim() || episodio.synopsis.trim();
  const apresentacaoDaNovela =
    posicao === 1 ? novela.tagline.trim() || novela.synopsis.trim() : "";
  const gancho = textoDoEpisodio || apresentacaoDaNovela;

  return {
    chave: episodio.id,
    origem,
    episodio: {
      id: episodio.id,
      numero: episodio.number,
      temporada: episodio.season.number,
      titulo: episodio.title,
      sinopse: episodio.synopsis,
      gancho,
      duracaoSec: episodio.durationSec,
      capaUrl: posterUrl(episodio.thumbKey),
      posicao,
      total,
    },
    novela: {
      id: novela.id,
      slug: novela.slug,
      titulo: novela.title,
      accent: novela.accent,
      posterUrl: posterUrl(novela.posterKey),
      tags: novela.tags.slice(0, 3),
      ageRating: novela.ageRating,
    },
    fonte,
    bloqueio: decisao.allowed ? null : decisao.reason,
    retomarEm,
    social: {
      curtidas: episodio.likeCount,
      comentarios: episodio._count.comments,
      envios: episodio.shareCount,
      curtido,
    },
  };
}

/** Curtidas do espectador entre um conjunto de episódios, em uma consulta. */
async function curtidasDoViewer(
  viewerId: string | null,
  episodeIds: string[],
): Promise<Set<string>> {
  if (!viewerId || episodeIds.length === 0) return new Set();
  const linhas = await db.episodeLike.findMany({
    where: { userId: viewerId, episodeId: { in: episodeIds } },
    select: { episodeId: true },
  });
  return new Set(linhas.map((l) => l.episodeId));
}

/**
 * Episódios de uma novela em ordem absoluta.
 *
 * Carregar a novela inteira dá o índice de graça: a posição no array **é** o
 * `episodeIndex` que a regra de amostra grátis exige, sem um `count` por
 * episódio. Uma novela tem dezenas de episódios, não milhares — o custo é uma
 * consulta, e ela também entrega o total para o rótulo "Ep 4 de 20".
 */
async function episodiosEmOrdem(novelaId: string) {
  return db.episode.findMany({
    where: { novelaId, isBonus: false },
    orderBy: [{ season: { number: "asc" } }, { number: "asc" }],
    select: EPISODIO_SELECT,
  });
}

// ------------------------------------------------------------ continuação

/**
 * Emenda a continuação de uma novela a partir de um episódio.
 *
 * `incluirAtual` distingue os dois chamadores: a fila inicial quer recomeçar
 * no episódio pendente (a pessoa parou no meio dele), enquanto a costura
 * disparada por um gancho quer o que vem **depois** da lâmina que ela já está
 * vendo.
 */
export async function continuacaoDaNovela({
  novelaId,
  apartirDoEpisodioId,
  incluirAtual,
  quantidade = LOTE_SERIE,
  viewerId,
  entitlement,
  excluir = new Set<string>(),
}: {
  novelaId: string;
  apartirDoEpisodioId: string | null;
  incluirAtual: boolean;
  quantidade?: number;
  viewerId: string | null;
  entitlement: Entitlement;
  excluir?: Set<string>;
}): Promise<LaminaReel[]> {
  const [novela, episodios] = await Promise.all([
    db.novela.findUnique({ where: { id: novelaId }, select: NOVELA_SELECT }),
    episodiosEmOrdem(novelaId),
  ]);
  if (!novela || episodios.length === 0) return [];

  const indiceAtual = apartirDoEpisodioId
    ? episodios.findIndex((e) => e.id === apartirDoEpisodioId)
    : -1;
  const inicio =
    indiceAtual < 0 ? 0 : incluirAtual ? indiceAtual : indiceAtual + 1;

  const fatia = episodios
    .slice(inicio, inicio + quantidade + excluir.size)
    .filter((e) => !excluir.has(e.id))
    .slice(0, quantidade);
  if (fatia.length === 0) return [];

  const ids = fatia.map((e) => e.id);
  const [curtidos, progressos] = await Promise.all([
    curtidasDoViewer(viewerId, ids),
    viewerId
      ? db.watchProgress.findMany({
          where: { userId: viewerId, episodeId: { in: ids } },
          select: { episodeId: true, positionSec: true, completed: true },
        })
      : Promise.resolve([]),
  ]);
  const porEpisodio = new Map(progressos.map((p) => [p.episodeId, p]));

  const montadas = fatia.map((episodio) => {
    const posicao = episodios.findIndex((e) => e.id === episodio.id) + 1;
    const progresso = porEpisodio.get(episodio.id);
    return montarLamina({
      episodio,
      novela,
      origem: "serie",
      posicao,
      total: episodios.length,
      entitlement,
      viewerId,
      retomarEm: progresso?.completed ? 0 : (progresso?.positionSec ?? 0),
      curtido: curtidos.has(episodio.id),
    });
  });

  // Um bloqueio, e a série para.
  //
  // Depois da amostra grátis, todo episódio seguinte está bloqueado. Emitir o
  // lote inteiro entregaria quatro telas de cadeado idênticas em sequência — a
  // pessoa deslizaria por um paredão e concluiria que o aplicativo acabou. Uma
  // única lâmina de bloqueio faz o convite, e a descoberta assume dali em
  // diante, que é onde ela ainda tem o que ver.
  const primeiroBloqueio = montadas.findIndex((l) => l.bloqueio !== null);
  return primeiroBloqueio < 0
    ? montadas
    : montadas.slice(0, primeiroBloqueio + 1);
}

// ---------------------------------------------------------------- ganchos

/**
 * Ganchos de novelas que a pessoa ainda não abriu.
 *
 * A ordenação é declaradamente simples e explicável: gênero que a pessoa
 * escolheu no onboarding primeiro, depois destaque editorial, depois acessos.
 * Não há modelo de recomendação escondido — quando existir, ele entra aqui e
 * o resto da fila não muda.
 */
export async function ganchosDeDescoberta({
  viewerId,
  entitlement,
  generosPreferidos,
  excluirNovelas,
  excluirEpisodios = new Set<string>(),
  quantidade = LOTE_GANCHOS,
}: {
  viewerId: string | null;
  entitlement: Entitlement;
  generosPreferidos: string[];
  excluirNovelas: Set<string>;
  excluirEpisodios?: Set<string>;
  quantidade?: number;
}): Promise<LaminaReel[]> {
  const candidatas = await db.novela.findMany({
    where: {
      id: { notIn: [...excluirNovelas] },
      status: { not: "COMING_SOON" },
      episodes: { some: {} },
    },
    orderBy: [{ isFeatured: "desc" }, { viewCount: "desc" }, { releasedAt: "desc" }],
    // Folga proposital: a reordenação por afinidade acontece em memória, então
    // é preciso mais candidatas do que lâminas para a preferência ter efeito.
    take: quantidade * 3,
    select: {
      ...NOVELA_SELECT,
      isFeatured: true,
      viewCount: true,
      genres: { select: { genreId: true } },
      _count: { select: { episodes: true } },
    },
  });

  const preferidos = new Set(generosPreferidos);
  const ordenadas = candidatas
    .map((novela) => ({
      novela,
      afim: novela.genres.some((g) => preferidos.has(g.genreId)),
    }))
    .sort((a, b) => Number(b.afim) - Number(a.afim))
    .slice(0, quantidade);

  if (ordenadas.length === 0) return [];

  // Uma consulta para todas as aberturas, em vez de uma por novela.
  const aberturas = await db.episode.findMany({
    where: {
      novelaId: { in: ordenadas.map((o) => o.novela.id) },
      isBonus: false,
      season: { number: 1 },
      number: 1,
    },
    select: { ...EPISODIO_SELECT, novelaId: true },
  });
  const porNovela = new Map(aberturas.map((e) => [e.novelaId, e]));

  const laminas: LaminaReel[] = [];
  const ids = aberturas.map((e) => e.id);
  const curtidos = await curtidasDoViewer(viewerId, ids);

  for (const { novela } of ordenadas) {
    const episodio = porNovela.get(novela.id);
    if (!episodio || excluirEpisodios.has(episodio.id)) continue;
    laminas.push(
      montarLamina({
        episodio,
        novela,
        origem: "gancho",
        posicao: 1,
        total: novela._count.episodes,
        entitlement,
        viewerId,
        retomarEm: 0,
        curtido: curtidos.has(episodio.id),
      }),
    );
  }
  return laminas;
}

// ------------------------------------------------------------ fila inicial

export type FilaInicial = {
  laminas: LaminaReel[];
  /** Verdadeiro quando a fila abre numa novela já começada. */
  retomando: boolean;
};

/**
 * A fila com que o aplicativo abre.
 *
 * Abre onde a pessoa parou — quando existe onde parar. É a diferença entre um
 * aplicativo que lembra de você e um que recomeça do zero toda noite.
 */
export async function filaInicial({
  viewerId,
  entitlement,
  generosPreferidos,
}: {
  viewerId: string | null;
  entitlement: Entitlement;
  generosPreferidos: string[];
}): Promise<FilaInicial> {
  const laminas: LaminaReel[] = [];
  const novelasUsadas = new Set<string>();
  const episodiosUsados = new Set<string>();

  if (viewerId) {
    const pendentes = await db.watchProgress.findMany({
      where: { userId: viewerId, completed: false },
      orderBy: { updatedAt: "desc" },
      // Uma linha por novela: a mais recente. `distinct` do Prisma respeita a
      // ordenação, então isto devolve o ponto real de parada de cada obra.
      distinct: ["novelaId"],
      take: NOVELAS_EM_ANDAMENTO,
      select: { episodeId: true, novelaId: true },
    });

    for (const pendente of pendentes) {
      const bloco = await continuacaoDaNovela({
        novelaId: pendente.novelaId,
        apartirDoEpisodioId: pendente.episodeId,
        incluirAtual: true,
        viewerId,
        entitlement,
        excluir: episodiosUsados,
      });
      for (const lamina of bloco) {
        laminas.push(lamina);
        episodiosUsados.add(lamina.episodio.id);
      }
      novelasUsadas.add(pendente.novelaId);
    }
  }

  const retomando = laminas.length > 0;

  const ganchos = await ganchosDeDescoberta({
    viewerId,
    entitlement,
    generosPreferidos,
    excluirNovelas: novelasUsadas,
    excluirEpisodios: episodiosUsados,
  });

  return { laminas: [...laminas, ...ganchos], retomando };
}

/**
 * Próxima página de ganchos, para quando a pessoa chega ao fim da fila.
 *
 * Recebe o que já está na tela porque a fila vive na memória do cliente: sem
 * essa lista, a segunda página repetiria as mesmas novelas do começo.
 */
export async function maisGanchos({
  viewerId,
  entitlement,
  generosPreferidos,
  novelasNaFila,
}: {
  viewerId: string | null;
  entitlement: Entitlement;
  generosPreferidos: string[];
  novelasNaFila: string[];
}): Promise<LaminaReel[]> {
  return ganchosDeDescoberta({
    viewerId,
    entitlement,
    generosPreferidos,
    excluirNovelas: new Set(novelasNaFila),
  });
}
