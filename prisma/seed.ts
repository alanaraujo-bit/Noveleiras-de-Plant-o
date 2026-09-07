/**
 * Seed do catálogo de demonstração.
 *
 * Idempotente: pode rodar quantas vezes for necessário. Os dados vêm de
 * `data/catalog.ts`; quando houver catálogo real, troca-se a origem e roda-se
 * este mesmo script.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import {
  GENRES,
  NOVELAS,
  DEMO_MEMBERS,
  DEMO_POSTS,
} from "../data/catalog.ts";
import { normalizeText } from "../lib/text.ts";

const db = new PrismaClient();

const DEMO_EMAIL = "demo@noveleiras.app";
const DEMO_PASSWORD = "plantao123";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

async function seedGenres() {
  for (const [index, genre] of GENRES.entries()) {
    await db.genre.upsert({
      where: { slug: genre.slug },
      create: { ...genre, sort: index },
      update: { ...genre, sort: index },
    });
  }
  console.log(`  gêneros: ${GENRES.length}`);
}

async function seedCatalog() {
  const genres = await db.genre.findMany();
  const genreBySlug = new Map(genres.map((g) => [g.slug, g.id]));
  let episodeTotal = 0;

  for (const novela of NOVELAS) {
    const releasedAt = daysAgo(novela.releasedDaysAgo);
    const data = {
      title: novela.title,
      tagline: novela.tagline,
      synopsis: novela.synopsis,
      status: novela.status,
      accessTier: novela.accessTier,
      ageRating: novela.ageRating,
      year: novela.year,
      accent: novela.accent,
      posterKey: `gen:capa/${novela.slug}`,
      heroKey: `gen:hero/${novela.slug}`,
      editorialNote: novela.editorialNote ?? null,
      isFeatured: novela.featuredRank != null,
      featuredRank: novela.featuredRank ?? null,
      cast: novela.cast,
      tags: novela.tags,
      rating: novela.rating,
      ratingCount: novela.ratingCount,
      viewCount: novela.popularity,
      releasedAt,
      searchText: normalizeText(
        [
          novela.title,
          novela.tagline,
          novela.synopsis,
          novela.tags.join(" "),
          novela.cast.map((person) => person.name + " " + person.role).join(" "),
          novela.genres.join(" "),
          String(novela.year),
        ].join(" "),
      ),
    };

    const record = await db.novela.upsert({
      where: { slug: novela.slug },
      create: { slug: novela.slug, ...data },
      update: data,
    });

    await db.novelaGenre.deleteMany({ where: { novelaId: record.id } });
    await db.novelaGenre.createMany({
      data: novela.genres
        .map((slug) => genreBySlug.get(slug))
        .filter((id): id is string => Boolean(id))
        .map((genreId) => ({ novelaId: record.id, genreId })),
    });

    let absoluteIndex = 0;
    for (const season of novela.seasons) {
      const seasonRecord = await db.season.upsert({
        where: { novelaId_number: { novelaId: record.id, number: season.number } },
        create: {
          novelaId: record.id,
          number: season.number,
          title: season.title,
          synopsis: season.synopsis,
        },
        update: { title: season.title, synopsis: season.synopsis },
      });

      for (const [index, episode] of season.episodes.entries()) {
        absoluteIndex += 1;
        const number = index + 1;
        const episodeData = {
          novelaId: record.id,
          title: episode.title,
          synopsis: episode.synopsis,
          durationSec: episode.durationSec,
          accessTier: (episode.premium ? "PREMIUM" : "FREE") as
            | "PREMIUM"
            | "FREE",
          // Chave opaca: a camada de mídia decide de onde isso é servido.
          mediaKey: `demo/${novela.slug}/s${season.number}e${number}.mp4`,
          mediaProvider: "LOCAL" as const,
          mediaFormat: "mp4",
          thumbKey: `gen:cena/${novela.slug}/${season.number}-${number}`,
          releasedAt: daysAgo(
            Math.max(novela.releasedDaysAgo - absoluteIndex * 2, -30),
          ),
          viewCount: Math.max(
            0,
            Math.round(novela.popularity / (1 + absoluteIndex * 0.35)),
          ),
        };

        await db.episode.upsert({
          where: {
            seasonId_number: { seasonId: seasonRecord.id, number },
          },
          create: { seasonId: seasonRecord.id, number, ...episodeData },
          update: episodeData,
        });
        episodeTotal += 1;
      }
    }

    await db.novela.update({
      where: { id: record.id },
      data: { updatedAt: new Date() },
    });
  }

  console.log(`  novelas: ${NOVELAS.length} · episódios: ${episodeTotal}`);
}

async function seedMembers() {
  const passwordHash = await bcrypt.hash("comunidade123", 10);
  for (const member of DEMO_MEMBERS) {
    await db.user.upsert({
      where: { email: member.email },
      create: {
        ...member,
        passwordHash,
        onboardedAt: daysAgo(40),
        lastSeenAt: hoursAgo(3),
        preference: { create: {} },
        subscription: { create: { plan: "PREMIUM", status: "ACTIVE" } },
      },
      update: { name: member.name, avatarSeed: member.avatarSeed },
    });
  }
  console.log(`  membros da comunidade: ${DEMO_MEMBERS.length}`);
}

async function seedFeed() {
  const users = await db.user.findMany({
    where: { email: { endsWith: "@demo.noveleiras.app" } },
  });
  const byHandle = new Map(users.map((u) => [u.handle, u]));
  const novelas = await db.novela.findMany({ select: { id: true, slug: true } });
  const novelaBySlug = new Map(novelas.map((n) => [n.slug, n.id]));

  // Recria o feed de demonstração para manter o seed idempotente.
  await db.post.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });

  for (const seed of DEMO_POSTS) {
    const author = byHandle.get(seed.handle);
    if (!author) continue;
    const createdAt = hoursAgo(seed.hoursAgo);

    const post = await db.post.create({
      data: {
        userId: author.id,
        novelaId: seed.novelaSlug
          ? (novelaBySlug.get(seed.novelaSlug) ?? null)
          : null,
        kind: seed.kind,
        body: seed.body,
        spoiler: seed.spoiler ?? false,
        rating: seed.rating ?? null,
        likeCount: seed.likes,
        commentCount: seed.comments.length,
        createdAt,
        updatedAt: createdAt,
      },
    });

    for (const comment of seed.comments) {
      const commenter = byHandle.get(comment.handle);
      if (!commenter) continue;
      await db.comment.create({
        data: {
          postId: post.id,
          userId: commenter.id,
          body: comment.body,
          createdAt: hoursAgo(comment.hoursAgo),
        },
      });
    }
  }
  console.log(`  publicações no feed: ${DEMO_POSTS.length}`);
}

/**
 * Conta de demonstração já "morando" no app: progresso, lista e histórico
 * prontos para que a Home nasça personalizada na primeira visita.
 */
async function seedDemoViewer() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const viewer = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: "Alan",
      handle: "alan",
      avatarSeed: "3",
      onboardedAt: daysAgo(21),
      lastSeenAt: new Date(),
      preference: {
        create: {
          favoriteGenreIds: [],
          autoplayNext: true,
        },
      },
      subscription: {
        create: {
          plan: "PREMIUM",
          status: "ACTIVE",
          startedAt: daysAgo(21),
          currentPeriodEnd: daysAgo(-9),
          priceCents: 1990,
          provider: "demo",
        },
      },
    },
    update: { passwordHash },
  });

  const plan: {
    slug: string;
    season: number;
    episode: number;
    percent: number;
    hoursAgo: number;
  }[] = [
    { slug: "coracao-em-plantao", season: 1, episode: 5, percent: 47, hoursAgo: 6 },
    { slug: "herdeira-do-silencio", season: 1, episode: 3, percent: 22, hoursAgo: 20 },
    { slug: "doce-vinganca-de-marina", season: 1, episode: 2, percent: 100, hoursAgo: 52 },
    { slug: "a-noiva-de-aluguel", season: 1, episode: 1, percent: 78, hoursAgo: 96 },
  ];

  for (const item of plan) {
    const episode = await db.episode.findFirst({
      where: {
        novela: { slug: item.slug },
        number: item.episode,
        season: { number: item.season },
      },
    });
    if (!episode) continue;

    const positionSec = Math.round((episode.durationSec * item.percent) / 100);
    const watchedMs = positionSec * 1000;
    const updatedAt = hoursAgo(item.hoursAgo);

    // Episódios anteriores marcados como concluídos: histórico coerente.
    const earlier = await db.episode.findMany({
      where: { novelaId: episode.novelaId, number: { lt: item.episode } },
    });
    for (const [i, previous] of earlier.entries()) {
      await db.watchProgress.upsert({
        where: {
          userId_episodeId: { userId: viewer.id, episodeId: previous.id },
        },
        create: {
          userId: viewer.id,
          episodeId: previous.id,
          novelaId: previous.novelaId,
          positionSec: previous.durationSec,
          durationSec: previous.durationSec,
          percent: 100,
          completed: true,
          watchedMs: previous.durationSec * 1000,
          firstPlayAt: hoursAgo(item.hoursAgo + (earlier.length - i) * 2),
          updatedAt: hoursAgo(item.hoursAgo + (earlier.length - i)),
        },
        update: {},
      });
    }

    await db.watchProgress.upsert({
      where: { userId_episodeId: { userId: viewer.id, episodeId: episode.id } },
      create: {
        userId: viewer.id,
        episodeId: episode.id,
        novelaId: episode.novelaId,
        positionSec,
        durationSec: episode.durationSec,
        percent: item.percent,
        completed: item.percent >= 95,
        watchedMs,
        firstPlayAt: updatedAt,
        updatedAt,
      },
      update: { positionSec, percent: item.percent, updatedAt },
    });
  }

  for (const slug of [
    "herdeira-do-silencio",
    "sete-dias-de-fevereiro",
    "amor-em-segunda-chamada",
  ]) {
    const novela = await db.novela.findUnique({ where: { slug } });
    if (!novela) continue;
    await db.favorite.upsert({
      where: { userId_novelaId: { userId: viewer.id, novelaId: novela.id } },
      create: { userId: viewer.id, novelaId: novela.id },
      update: {},
    });
  }

  await db.novela.updateMany({
    where: {
      slug: {
        in: [
          "herdeira-do-silencio",
          "sete-dias-de-fevereiro",
          "amor-em-segunda-chamada",
        ],
      },
    },
    data: { favoriteCount: { increment: 0 } },
  });

  console.log(`  conta de demonstração: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

/** Contadores denormalizados coerentes com o que foi semeado. */
async function reconcileCounters() {
  const grouped = await db.favorite.groupBy({
    by: ["novelaId"],
    _count: { novelaId: true },
  });
  for (const row of grouped) {
    await db.novela.update({
      where: { id: row.novelaId },
      data: { favoriteCount: row._count.novelaId },
    });
  }
}

async function main() {
  console.log("Semeando Noveleiras de Plantão…");
  await seedGenres();
  await seedCatalog();
  await seedMembers();
  await seedFeed();
  await seedDemoViewer();
  await reconcileCounters();
  console.log("Pronto.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
