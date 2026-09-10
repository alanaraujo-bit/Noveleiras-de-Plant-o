import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { indicador, type Indicador } from "@/lib/painel/numeros";
import type { Periodo } from "@/lib/painel/tempo";
import {
  serieTemporal,
  totalNoPeriodo,
  type Serie,
} from "@/lib/painel/metricas/base";

/**
 * Comunidade.
 *
 * A conversa deixou de acontecer num feed separado e passou para dentro do
 * episódio. Esta tela acompanhou a mudança: o que ela modera agora é
 * `EpisodeComment` — a mesma pergunta operacional, com a fonte no lugar onde
 * o conteúdo passou a existir.
 *
 * A forma da tela não mudou porque o formato da conversa não mudou. Uma raiz
 * (`parentId` nulo) faz o papel do antigo post; as respostas fazem o dos
 * comentários; `EpisodeCommentLike` faz o das curtidas. `Report` continua
 * dizendo o que foi sinalizado e ainda espera decisão — e a tela segue
 * dividida nessa linha: o que aconteceu à esquerda, o que exige uma pessoa à
 * direita.
 *
 * Conteúdo oculto não é conteúdo apagado: `hiddenAt` some do aplicativo mas
 * continua aqui, porque moderação sem histórico é moderação irrevisável.
 * Ocultar uma raiz tira a conversa inteira de vista sem apagar as respostas.
 */

/** Raiz de conversa: o que antes era um post. */
const RAIZES = Prisma.sql`"parentId" IS NULL`;
/** Resposta dentro de uma conversa: o que antes era um comentário. */
const RESPOSTAS = Prisma.sql`"parentId" IS NOT NULL`;

export type ResumoDaComunidade = {
  posts: Indicador;
  comentarios: Indicador;
  curtidas: Indicador;
  autores: Indicador;
  ocultos: number;
  comentariosOcultos: number;
  denunciasAbertas: number;
  denunciasNoPeriodo: Indicador;
  tempoMedioDeResolucaoMs: number | null;
  series: {
    posts: Serie;
    postsAnterior: Serie;
    comentarios: Serie;
  };
};

const AUTORES_DISTINTOS = Prisma.sql`count(DISTINCT "userId")::float8`;

export async function resumoDaComunidade(
  periodo: Periodo,
): Promise<ResumoDaComunidade> {
  const [
    posts,
    comentarios,
    curtidas,
    autores,
    ocultos,
    comentariosOcultos,
    abertas,
    denuncias,
    resolucao,
    seriePosts,
    seriePostsAnterior,
    serieComentarios,
  ] = await Promise.all([
    totalNoPeriodo({
      tabela: "EpisodeComment",
      coluna: "createdAt",
      periodo,
      filtro: RAIZES,
    }),
    totalNoPeriodo({
      tabela: "EpisodeComment",
      coluna: "createdAt",
      periodo,
      filtro: RESPOSTAS,
    }),
    totalNoPeriodo({
      tabela: "EpisodeCommentLike",
      coluna: "createdAt",
      periodo,
    }),
    totalNoPeriodo({
      tabela: "EpisodeComment",
      coluna: "createdAt",
      periodo,
      expressao: AUTORES_DISTINTOS,
    }),
    db.episodeComment.count({
      where: { parentId: null, hiddenAt: { not: null } },
    }),
    db.episodeComment.count({
      where: { parentId: { not: null }, hiddenAt: { not: null } },
    }),
    db.report.count({ where: { state: { in: ["OPEN", "REVIEWING"] } } }),
    totalNoPeriodo({ tabela: "Report", coluna: "createdAt", periodo }),
    db.$queryRaw<{ media: number | null }[]>(Prisma.sql`
      SELECT avg(extract(epoch FROM ("resolvedAt" - "createdAt")) * 1000)::float8
        AS media
      FROM "Report"
      WHERE "resolvedAt" IS NOT NULL
        AND "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
    `),
    serieTemporal({
      tabela: "EpisodeComment",
      coluna: "createdAt",
      periodo,
      filtro: RAIZES,
    }),
    serieTemporal({
      tabela: "EpisodeComment",
      coluna: "createdAt",
      periodo,
      anterior: true,
      filtro: RAIZES,
    }),
    serieTemporal({
      tabela: "EpisodeComment",
      coluna: "createdAt",
      periodo,
      filtro: RESPOSTAS,
    }),
  ]);

  return {
    posts: indicador(posts.atual, posts.anterior),
    comentarios: indicador(comentarios.atual, comentarios.anterior),
    curtidas: indicador(curtidas.atual, curtidas.anterior),
    autores: indicador(autores.atual, autores.anterior),
    ocultos,
    comentariosOcultos,
    denunciasAbertas: abertas,
    denunciasNoPeriodo: indicador(denuncias.atual, denuncias.anterior),
    tempoMedioDeResolucaoMs: resolucao[0]?.media ?? null,
    series: {
      posts: seriePosts,
      postsAnterior: seriePostsAnterior,
      comentarios: serieComentarios,
    },
  };
}

export type LinhaDePost = {
  id: string;
  corpo: string;
  spoiler: boolean;
  oculto: boolean;
  ocultadoEm: Date | null;
  criadoEm: Date;
  curtidas: number;
  comentarios: number;
  autor: { id: string; nome: string; handle: string; demo: boolean } | null;
  novela: { id: string; titulo: string } | null;
  /** Episódio onde a conversa acontece. É por ele que se chega ao conteúdo. */
  episodio: { id: string; numero: number; temporada: number } | null;
  denunciasAbertas: number;
};

export type FiltroDaComunidade = {
  periodo: Periodo;
  termo?: string;
  /** "ocultos", "visiveis", "denunciados" ou vazio. */
  situacao?: string;
  novelaId?: string;
  pagina?: number;
  porPagina?: number;
};

/**
 * Denúncias abertas por alvo.
 *
 * `Report.targetId` é um id solto — não há relação no schema, porque uma
 * denúncia sobrevive ao que ela denuncia. Resolvida em lote, como os títulos
 * de `Event`.
 *
 * Os tipos POST e COMMENT continuam aceitos porque continuam gravados: uma
 * denúncia antiga é um fato datado, e apagá-la para arrumar o enum reescreveria
 * história. A tela só emite EPISODE_COMMENT daqui em diante.
 */
async function denunciasPorAlvo(
  tipo: "EPISODE_COMMENT" | "POST" | "COMMENT",
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const linhas = await db.$queryRaw<{ id: string; total: number }[]>(Prisma.sql`
    SELECT "targetId" AS id, count(*)::int AS total
    FROM "Report"
    WHERE "targetType"::text = ${tipo}
      AND "state"::text IN ('OPEN', 'REVIEWING')
      AND "targetId" IN (${Prisma.join(ids)})
    GROUP BY 1
  `);
  return new Map(linhas.map((linha) => [linha.id, Number(linha.total)]));
}

export async function listarPosts(filtro: FiltroDaComunidade): Promise<{
  linhas: LinhaDePost[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, filtro.porPagina ?? 25));
  const pagina = Math.max(1, filtro.pagina ?? 1);

  // Só as raízes entram na lista: uma conversa é uma linha, e as respostas
  // aparecem ao abri-la. Listar resposta no mesmo nível quebraria a paginação
  // — o mesmo assunto ocuparia dez linhas.
  const onde: Prisma.EpisodeCommentWhereInput = {
    parentId: null,
    createdAt: { gte: filtro.periodo.inicio, lt: filtro.periodo.fim },
  };
  if (filtro.termo?.trim()) {
    onde.body = { contains: filtro.termo.trim(), mode: "insensitive" };
  }
  if (filtro.novelaId) onde.episode = { novelaId: filtro.novelaId };
  if (filtro.situacao === "ocultos") onde.hiddenAt = { not: null };
  else if (filtro.situacao === "visiveis") onde.hiddenAt = null;

  // "Denunciados" não é coluna de Post: é a existência de um Report apontando
  // para ele. Resolvido antes da consulta, para que a paginação continue
  // contando o mesmo conjunto que exibe.
  if (filtro.situacao === "denunciados") {
    const alvos = await db.report.findMany({
      where: {
        targetType: "EPISODE_COMMENT",
        state: { in: ["OPEN", "REVIEWING"] },
      },
      select: { targetId: true },
      distinct: ["targetId"],
    });
    onde.id = { in: alvos.map((alvo) => alvo.targetId) };
  }

  const [total, conversas] = await Promise.all([
    db.episodeComment.count({ where: onde }),
    db.episodeComment.findMany({
      where: onde,
      orderBy: { createdAt: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      select: {
        id: true,
        body: true,
        spoiler: true,
        hiddenAt: true,
        createdAt: true,
        _count: { select: { likes: true, replies: true } },
        user: { select: { id: true, name: true, handle: true, isDemo: true } },
        episode: {
          select: {
            id: true,
            number: true,
            season: { select: { number: true } },
            novela: { select: { id: true, title: true } },
          },
        },
      },
    }),
  ]);

  const denuncias = await denunciasPorAlvo(
    "EPISODE_COMMENT",
    conversas.map((conversa) => conversa.id),
  );

  return {
    linhas: conversas.map((conversa) => ({
      id: conversa.id,
      corpo: conversa.body,
      spoiler: conversa.spoiler,
      oculto: conversa.hiddenAt !== null,
      ocultadoEm: conversa.hiddenAt,
      criadoEm: conversa.createdAt,
      curtidas: conversa._count.likes,
      comentarios: conversa._count.replies,
      autor: conversa.user
        ? {
            id: conversa.user.id,
            nome: conversa.user.name,
            handle: conversa.user.handle,
            demo: conversa.user.isDemo,
          }
        : null,
      novela: {
        id: conversa.episode.novela.id,
        titulo: conversa.episode.novela.title,
      },
      episodio: {
        id: conversa.episode.id,
        numero: conversa.episode.number,
        temporada: conversa.episode.season.number,
      },
      denunciasAbertas: denuncias.get(conversa.id) ?? 0,
    })),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}

export type LinhaDeDenuncia = {
  id: string;
  tipoDoAlvo: string;
  alvoId: string;
  motivo: string;
  detalhe: string | null;
  estado: string;
  criadaEm: Date;
  resolvidaEm: Date | null;
  resolucao: string | null;
  quemDenunciou: { id: string; nome: string; handle: string } | null;
  /**
   * Denúncia sem autor registrado.
   *
   * Diferente de autor que sumiu: `null` em `reporterId` é anônimo por
   * origem; `reporterId` preenchido cuja conta não existe mais é conta
   * removida. Dizer "conta removida" para os dois casos inventaria um
   * histórico que nunca houve.
   */
  anonima: boolean;
  /** Trecho do que foi denunciado, resolvido em lote. */
  previa: string | null;
  /** Se o alvo já está oculto — uma denúncia pode chegar depois da ação. */
  alvoOculto: boolean;
  alvoExiste: boolean;
};

export const ESTADOS_DE_DENUNCIA = [
  "OPEN",
  "REVIEWING",
  "RESOLVED",
  "DISMISSED",
] as const;

export async function listarDenuncias(opcoes: {
  periodo: Periodo;
  estado?: string;
  /** Ignora o período e mostra tudo que ainda espera decisão. */
  apenasPendentes?: boolean;
  pagina?: number;
  porPagina?: number;
}): Promise<{
  linhas: LinhaDeDenuncia[];
  total: number;
  pagina: number;
  paginas: number;
}> {
  const porPagina = Math.min(100, Math.max(10, opcoes.porPagina ?? 25));
  const pagina = Math.max(1, opcoes.pagina ?? 1);

  const onde: Prisma.ReportWhereInput = opcoes.apenasPendentes
    ? { state: { in: ["OPEN", "REVIEWING"] } }
    : { createdAt: { gte: opcoes.periodo.inicio, lt: opcoes.periodo.fim } };

  if (
    opcoes.estado &&
    (ESTADOS_DE_DENUNCIA as readonly string[]).includes(opcoes.estado)
  ) {
    onde.state = opcoes.estado as (typeof ESTADOS_DE_DENUNCIA)[number];
  }

  const [total, denuncias] = await Promise.all([
    db.report.count({ where: onde }),
    db.report.findMany({
      where: onde,
      orderBy: [{ state: "asc" }, { createdAt: "desc" }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);

  const idsDePost = denuncias
    .filter((denuncia) => denuncia.targetType === "POST")
    .map((denuncia) => denuncia.targetId);
  const idsDeComentario = denuncias
    .filter((denuncia) => denuncia.targetType === "COMMENT")
    .map((denuncia) => denuncia.targetId);
  const idsDeUsuario = denuncias
    .filter((denuncia) => denuncia.targetType === "USER")
    .map((denuncia) => denuncia.targetId);
  const idsDeDenunciante = denuncias
    .map((denuncia) => denuncia.reporterId)
    .filter((id): id is string => Boolean(id));

  const [posts, comentarios, usuarios, denunciantes] = await Promise.all([
    idsDePost.length
      ? db.post.findMany({
          where: { id: { in: idsDePost } },
          select: { id: true, body: true, hiddenAt: true },
        })
      : [],
    idsDeComentario.length
      ? db.comment.findMany({
          where: { id: { in: idsDeComentario } },
          select: { id: true, body: true, hiddenAt: true },
        })
      : [],
    idsDeUsuario.length
      ? db.user.findMany({
          where: { id: { in: idsDeUsuario } },
          select: { id: true, name: true, handle: true, status: true },
        })
      : [],
    idsDeDenunciante.length
      ? db.user.findMany({
          where: { id: { in: idsDeDenunciante } },
          select: { id: true, name: true, handle: true },
        })
      : [],
  ]);

  const porPost = new Map(posts.map((post) => [post.id, post]));
  const porComentario = new Map(
    comentarios.map((comentario) => [comentario.id, comentario]),
  );
  const porUsuario = new Map(usuarios.map((usuario) => [usuario.id, usuario]));
  const porDenunciante = new Map(
    denunciantes.map((usuario) => [usuario.id, usuario]),
  );

  return {
    linhas: denuncias.map((denuncia) => {
      const post =
        denuncia.targetType === "POST"
          ? porPost.get(denuncia.targetId)
          : undefined;
      const comentario =
        denuncia.targetType === "COMMENT"
          ? porComentario.get(denuncia.targetId)
          : undefined;
      const usuario =
        denuncia.targetType === "USER"
          ? porUsuario.get(denuncia.targetId)
          : undefined;
      const quem = denuncia.reporterId
        ? porDenunciante.get(denuncia.reporterId)
        : undefined;

      return {
        id: denuncia.id,
        tipoDoAlvo: denuncia.targetType,
        alvoId: denuncia.targetId,
        motivo: denuncia.reason,
        detalhe: denuncia.detail,
        estado: denuncia.state,
        criadaEm: denuncia.createdAt,
        resolvidaEm: denuncia.resolvedAt,
        resolucao: denuncia.resolution,
        quemDenunciou: quem
          ? { id: quem.id, nome: quem.name, handle: quem.handle }
          : null,
        anonima: denuncia.reporterId === null,
        previa:
          post?.body ??
          comentario?.body ??
          (usuario ? `@${usuario.handle} · ${usuario.name}` : null),
        alvoOculto:
          post?.hiddenAt != null ||
          comentario?.hiddenAt != null ||
          usuario?.status === "SUSPENDED",
        alvoExiste: Boolean(post ?? comentario ?? usuario),
      };
    }),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  };
}

export type ComentarioDoPost = {
  id: string;
  corpo: string;
  criadoEm: Date;
  oculto: boolean;
  autor: { id: string; nome: string; handle: string } | null;
  denunciasAbertas: number;
};

/**
 * Uma conversa inteira, para a tela de detalhe.
 *
 * O id recebido é o da raiz. Ele chega da lista, e a lista só emite raízes —
 * mas a checagem de `parentId` fica no `where` mesmo assim: um link colado à
 * mão apontando para uma resposta abriria uma tela sem as respostas dela, o que
 * pareceria uma conversa vazia em vez de um endereço errado.
 */
export async function postComComentarios(raizId: string) {
  const raiz = await db.episodeComment.findFirst({
    where: { id: raizId, parentId: null },
    select: {
      id: true,
      body: true,
      spoiler: true,
      hiddenAt: true,
      createdAt: true,
      _count: { select: { likes: true, replies: true } },
      user: {
        select: {
          id: true,
          name: true,
          handle: true,
          isDemo: true,
          status: true,
        },
      },
      episode: {
        select: {
          id: true,
          number: true,
          title: true,
          season: { select: { number: true } },
          novela: { select: { id: true, title: true } },
        },
      },
      replies: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          hiddenAt: true,
          user: { select: { id: true, name: true, handle: true } },
        },
      },
    },
  });
  if (!raiz) return null;

  const [denunciasDaRaiz, denunciasDasRespostas] = await Promise.all([
    db.report.findMany({
      where: { targetType: "EPISODE_COMMENT", targetId: raizId },
      orderBy: { createdAt: "desc" },
    }),
    denunciasPorAlvo(
      "EPISODE_COMMENT",
      raiz.replies.map((resposta) => resposta.id),
    ),
  ]);

  return {
    post: {
      ...raiz,
      novela: raiz.episode.novela,
      // A tela mostrava `kind` e `rating`, que eram do post e não existem numa
      // conversa de episódio. Vão embora em vez de virar campos sempre nulos:
      // um campo que nunca tem valor é ruído com aparência de dado.
    },
    comentarios: raiz.replies.map((resposta) => ({
      id: resposta.id,
      corpo: resposta.body,
      criadoEm: resposta.createdAt,
      oculto: resposta.hiddenAt !== null,
      autor: resposta.user
        ? {
            id: resposta.user.id,
            nome: resposta.user.name,
            handle: resposta.user.handle,
          }
        : null,
      denunciasAbertas: denunciasDasRespostas.get(resposta.id) ?? 0,
    })) satisfies ComentarioDoPost[],
    denuncias: denunciasDaRaiz,
  };
}
