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
 * Três fatos e uma fila: `Post`, `Comment` e `PostLike` dizem o que foi
 * publicado; `Report` diz o que a comunidade sinalizou e ainda espera
 * decisão. A tela é dividida nessa linha — o que aconteceu à esquerda, o que
 * exige uma pessoa à direita.
 *
 * Conteúdo oculto não é conteúdo apagado: `hiddenAt` some do aplicativo mas
 * continua aqui, porque moderação sem histórico é moderação irrevisável.
 */

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
    totalNoPeriodo({ tabela: "Post", coluna: "createdAt", periodo }),
    totalNoPeriodo({ tabela: "Comment", coluna: "createdAt", periodo }),
    totalNoPeriodo({ tabela: "PostLike", coluna: "createdAt", periodo }),
    totalNoPeriodo({
      tabela: "Post",
      coluna: "createdAt",
      periodo,
      expressao: AUTORES_DISTINTOS,
    }),
    db.post.count({ where: { hiddenAt: { not: null } } }),
    db.comment.count({ where: { hiddenAt: { not: null } } }),
    db.report.count({ where: { state: { in: ["OPEN", "REVIEWING"] } } }),
    totalNoPeriodo({ tabela: "Report", coluna: "createdAt", periodo }),
    db.$queryRaw<{ media: number | null }[]>(Prisma.sql`
      SELECT avg(extract(epoch FROM ("resolvedAt" - "createdAt")) * 1000)::float8
        AS media
      FROM "Report"
      WHERE "resolvedAt" IS NOT NULL
        AND "createdAt" >= ${periodo.inicio} AND "createdAt" < ${periodo.fim}
    `),
    serieTemporal({ tabela: "Post", coluna: "createdAt", periodo }),
    serieTemporal({
      tabela: "Post",
      coluna: "createdAt",
      periodo,
      anterior: true,
    }),
    serieTemporal({ tabela: "Comment", coluna: "createdAt", periodo }),
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
  tipo: string;
  spoiler: boolean;
  oculto: boolean;
  ocultadoEm: Date | null;
  criadoEm: Date;
  curtidas: number;
  comentarios: number;
  autor: { id: string; nome: string; handle: string; demo: boolean } | null;
  novela: { id: string; titulo: string } | null;
  denunciasAbertas: number;
};

export const TIPOS_DE_POST = ["THOUGHT", "REVIEW", "THEORY"] as const;

export type FiltroDaComunidade = {
  periodo: Periodo;
  termo?: string;
  tipo?: string;
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
 */
async function denunciasPorAlvo(
  tipo: "POST" | "COMMENT",
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

  const onde: Prisma.PostWhereInput = {
    createdAt: { gte: filtro.periodo.inicio, lt: filtro.periodo.fim },
  };
  if (filtro.termo?.trim()) {
    onde.body = { contains: filtro.termo.trim(), mode: "insensitive" };
  }
  if (filtro.tipo && (TIPOS_DE_POST as readonly string[]).includes(filtro.tipo)) {
    onde.kind = filtro.tipo as (typeof TIPOS_DE_POST)[number];
  }
  if (filtro.novelaId) onde.novelaId = filtro.novelaId;
  if (filtro.situacao === "ocultos") onde.hiddenAt = { not: null };
  else if (filtro.situacao === "visiveis") onde.hiddenAt = null;

  // "Denunciados" não é coluna de Post: é a existência de um Report apontando
  // para ele. Resolvido antes da consulta, para que a paginação continue
  // contando o mesmo conjunto que exibe.
  if (filtro.situacao === "denunciados") {
    const alvos = await db.report.findMany({
      where: { targetType: "POST", state: { in: ["OPEN", "REVIEWING"] } },
      select: { targetId: true },
      distinct: ["targetId"],
    });
    onde.id = { in: alvos.map((alvo) => alvo.targetId) };
  }

  const [total, posts] = await Promise.all([
    db.post.count({ where: onde }),
    db.post.findMany({
      where: onde,
      orderBy: { createdAt: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      select: {
        id: true,
        body: true,
        kind: true,
        spoiler: true,
        hiddenAt: true,
        createdAt: true,
        _count: { select: { likes: true, comments: true } },
        user: { select: { id: true, name: true, handle: true, isDemo: true } },
        novela: { select: { id: true, title: true } },
      },
    }),
  ]);

  const denuncias = await denunciasPorAlvo(
    "POST",
    posts.map((post) => post.id),
  );

  return {
    linhas: posts.map((post) => ({
      id: post.id,
      corpo: post.body,
      tipo: post.kind,
      spoiler: post.spoiler,
      oculto: post.hiddenAt !== null,
      ocultadoEm: post.hiddenAt,
      criadoEm: post.createdAt,
      curtidas: post._count.likes,
      comentarios: post._count.comments,
      autor: post.user
        ? {
            id: post.user.id,
            nome: post.user.name,
            handle: post.user.handle,
            demo: post.user.isDemo,
          }
        : null,
      novela: post.novela
        ? { id: post.novela.id, titulo: post.novela.title }
        : null,
      denunciasAbertas: denuncias.get(post.id) ?? 0,
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

export async function postComComentarios(postId: string) {
  const post = await db.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      body: true,
      kind: true,
      spoiler: true,
      rating: true,
      hiddenAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { likes: true, comments: true } },
      user: {
        select: {
          id: true,
          name: true,
          handle: true,
          isDemo: true,
          status: true,
        },
      },
      novela: { select: { id: true, title: true } },
      episode: { select: { id: true, number: true, title: true } },
      comments: {
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
  if (!post) return null;

  const [denunciasDoPost, denunciasDosComentarios] = await Promise.all([
    db.report.findMany({
      where: { targetType: "POST", targetId: postId },
      orderBy: { createdAt: "desc" },
    }),
    denunciasPorAlvo(
      "COMMENT",
      post.comments.map((comentario) => comentario.id),
    ),
  ]);

  return {
    post,
    comentarios: post.comments.map((comentario) => ({
      id: comentario.id,
      corpo: comentario.body,
      criadoEm: comentario.createdAt,
      oculto: comentario.hiddenAt !== null,
      autor: comentario.user
        ? {
            id: comentario.user.id,
            nome: comentario.user.name,
            handle: comentario.user.handle,
          }
        : null,
      denunciasAbertas: denunciasDosComentarios.get(comentario.id) ?? 0,
    })) satisfies ComentarioDoPost[],
    denuncias: denunciasDoPost,
  };
}
