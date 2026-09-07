import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * A ficha de uma pessoa.
 *
 * Reúne, num lugar só, o que hoje estaria espalhado por sete tabelas: conta,
 * assinatura, pagamentos, sessões, progresso, favoritos, participação na
 * comunidade, eventos recentes e as ações administrativas que já recaíram
 * sobre ela. A investigação de um caso ("essa pessoa reclamou que perdeu o
 * progresso") não deveria exigir sete consultas escritas na mão.
 */

export type FichaDeUsuario = NonNullable<
  Awaited<ReturnType<typeof fichaDeUsuario>>
>;

export async function fichaDeUsuario(id: string) {
  const usuario = await db.user.findUnique({
    where: { id },
    include: {
      subscription: true,
      preference: true,
    },
  });
  if (!usuario) return null;

  const [
    sessoes,
    resumoSessoes,
    progresso,
    resumoProgresso,
    favoritos,
    buscas,
    posts,
    comentarios,
    pagamentos,
    eventos,
    acoesAdministrativas,
    novelasAcompanhadas,
  ] = await Promise.all([
    db.appSession.findMany({
      where: { userId: id },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),

    db.appSession.aggregate({
      where: { userId: id },
      _count: { _all: true },
      _sum: { durationMs: true, screenViews: true, watchedMs: true },
      _avg: { durationMs: true },
      _min: { startedAt: true },
    }),

    db.watchProgress.findMany({
      where: { userId: id },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: {
        episode: { select: { number: true, title: true, durationSec: true } },
        novela: { select: { slug: true, title: true, accent: true } },
      },
    }),

    db.watchProgress.aggregate({
      where: { userId: id },
      _count: { _all: true },
      _sum: { watchedMs: true, playCount: true },
      _avg: { percent: true },
    }),

    db.favorite.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      include: { novela: { select: { slug: true, title: true, accent: true } } },
    }),

    db.searchQuery.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),

    db.post.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { novela: { select: { title: true, slug: true } } },
    }),

    db.comment.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),

    db.payment.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),

    // `Event` guarda novelaId/episodeId como colunas soltas, sem relação —
    // proposital num log append-only: apagar uma novela não pode apagar o
    // registro de que ela foi assistida. Os títulos vêm depois, em lote.
    db.event.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),

    db.adminAudit.findMany({
      where: { targetType: "User", targetId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),

    // Quanto desta pessoa foi para cada novela: onde ela realmente mora.
    db.$queryRaw<
      {
        novelaId: string;
        slug: string;
        titulo: string;
        accent: string;
        episodios: number;
        concluidos: number;
        assistidoMs: number;
        ultimoEm: Date;
      }[]
    >(Prisma.sql`
      SELECT
        n."id" AS "novelaId", n."slug", n."title" AS titulo, n."accent",
        count(*)::int AS episodios,
        count(*) FILTER (WHERE p."completed")::int AS concluidos,
        coalesce(sum(p."watchedMs"), 0)::float8 AS "assistidoMs",
        max(p."updatedAt") AS "ultimoEm"
      FROM "WatchProgress" p
      JOIN "Novela" n ON n."id" = p."novelaId"
      WHERE p."userId" = ${id}
      GROUP BY n."id", n."slug", n."title", n."accent"
      ORDER BY "assistidoMs" DESC
    `),
  ]);

  const concluidos = await db.watchProgress.count({
    where: { userId: id, completed: true },
  });

  const [novelasDosEventos, episodiosDosEventos] = await Promise.all([
    db.novela.findMany({
      where: {
        id: { in: [...new Set(eventos.map((e) => e.novelaId).filter((v): v is string => !!v))] },
      },
      select: { id: true, title: true },
    }),
    db.episode.findMany({
      where: {
        id: { in: [...new Set(eventos.map((e) => e.episodeId).filter((v): v is string => !!v))] },
      },
      select: { id: true, title: true, number: true },
    }),
  ]);

  const tituloDaNovela = new Map(novelasDosEventos.map((n) => [n.id, n.title]));
  const episodioPorId = new Map(episodiosDosEventos.map((e) => [e.id, e]));

  return {
    usuario,
    sessoes,
    resumoSessoes: {
      total: resumoSessoes._count._all,
      tempoTotalMs: resumoSessoes._sum.durationMs ?? 0,
      tempoMedioMs: Math.round(resumoSessoes._avg.durationMs ?? 0),
      telas: resumoSessoes._sum.screenViews ?? 0,
      assistidoNaSessaoMs: resumoSessoes._sum.watchedMs ?? 0,
      primeiraEm: resumoSessoes._min.startedAt,
    },
    progresso,
    resumoProgresso: {
      episodios: resumoProgresso._count._all,
      concluidos,
      assistidoMs: resumoProgresso._sum.watchedMs ?? 0,
      reproducoes: resumoProgresso._sum.playCount ?? 0,
      percentualMedio: Math.round(resumoProgresso._avg.percent ?? 0),
    },
    favoritos,
    buscas,
    posts,
    comentarios,
    pagamentos,
    eventos: eventos.map((evento) => ({
      ...evento,
      novelaTitulo: evento.novelaId
        ? (tituloDaNovela.get(evento.novelaId) ?? null)
        : null,
      episodio: evento.episodeId
        ? (episodioPorId.get(evento.episodeId) ?? null)
        : null,
    })),
    acoesAdministrativas,
    novelasAcompanhadas,
  };
}
