/**
 * Reconcilia os contadores denormalizados com os fatos.
 *
 * `Novela.viewCount`, `Novela.favoriteCount`, `Novela.watchedMs`,
 * `Episode.viewCount` e `Episode.watchedMs` foram semeados com números de
 * vitrine — uma novela marca 12.481 acessos num banco com centenas de eventos.
 * O painel ignora essas colunas de propósito, mas o aplicativo público as usa
 * para manter "populares" barato. Enquanto elas mentirem, a vitrine mente.
 *
 * Este comando recalcula cada coluna a partir de `Event` e `Favorite` e mostra
 * a diferença. Ele não grava nada sem `--aplicar`: ver o estrago antes de
 * corrigi-lo é parte do trabalho.
 *
 *   npm run painel:reconciliar
 *   npm run painel:reconciliar -- --aplicar
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const APLICAR = process.argv.includes("--aplicar");

type Contagem = { id: string; total: number };

function paraMapa(linhas: Contagem[]): Map<string, number> {
  return new Map(linhas.map((linha) => [linha.id, Number(linha.total)]));
}

const numero = new Intl.NumberFormat("pt-BR");

function diferenca(atual: number, real: number): string {
  if (atual === real) return "ok";
  const sinal = real > atual ? "+" : "−";
  return `${numero.format(atual)} → ${numero.format(real)} (${sinal}${numero.format(Math.abs(real - atual))})`;
}

async function main() {
  const [
    novelas,
    episodios,
    playsPorNovela,
    playsPorEpisodio,
    tempoPorNovela,
    tempoPorEpisodio,
    favoritos,
  ] = await Promise.all([
    db.novela.findMany({
      select: {
        id: true,
        title: true,
        viewCount: true,
        favoriteCount: true,
        watchedMs: true,
      },
      orderBy: { title: "asc" },
    }),
    db.episode.findMany({
      select: { id: true, novelaId: true, viewCount: true, watchedMs: true },
    }),
    db.$queryRawUnsafe<Contagem[]>(`
      SELECT "novelaId" AS id, count(*)::int AS total FROM "Event"
      WHERE "type"::text = 'PLAY_START' AND "novelaId" IS NOT NULL GROUP BY 1
    `),
    db.$queryRawUnsafe<Contagem[]>(`
      SELECT "episodeId" AS id, count(*)::int AS total FROM "Event"
      WHERE "type"::text = 'PLAY_START' AND "episodeId" IS NOT NULL GROUP BY 1
    `),
    db.$queryRawUnsafe<Contagem[]>(`
      SELECT "novelaId" AS id, coalesce(sum("valueMs"), 0)::float8 AS total
      FROM "Event"
      WHERE "type"::text = 'PLAY_PROGRESS' AND "novelaId" IS NOT NULL GROUP BY 1
    `),
    db.$queryRawUnsafe<Contagem[]>(`
      SELECT "episodeId" AS id, coalesce(sum("valueMs"), 0)::float8 AS total
      FROM "Event"
      WHERE "type"::text = 'PLAY_PROGRESS' AND "episodeId" IS NOT NULL GROUP BY 1
    `),
    db.$queryRawUnsafe<Contagem[]>(`
      SELECT "novelaId" AS id, count(*)::int AS total FROM "Favorite" GROUP BY 1
    `),
  ]);

  const plays = paraMapa(playsPorNovela);
  const playsEp = paraMapa(playsPorEpisodio);
  const tempo = paraMapa(tempoPorNovela);
  const tempoEp = paraMapa(tempoPorEpisodio);
  const favoritados = paraMapa(favoritos);

  const alteracoes: {
    id: string;
    titulo: string;
    viewCount: number;
    favoriteCount: number;
    watchedMs: number;
  }[] = [];

  console.log(`\n  Novelas (${novelas.length})\n`);
  for (const novela of novelas) {
    const reais = {
      viewCount: plays.get(novela.id) ?? 0,
      favoriteCount: favoritados.get(novela.id) ?? 0,
      watchedMs: tempo.get(novela.id) ?? 0,
    };
    const atual = {
      viewCount: novela.viewCount,
      favoriteCount: novela.favoriteCount,
      watchedMs: Number(novela.watchedMs),
    };
    const igual =
      atual.viewCount === reais.viewCount &&
      atual.favoriteCount === reais.favoriteCount &&
      atual.watchedMs === reais.watchedMs;

    if (!igual) alteracoes.push({ id: novela.id, titulo: novela.title, ...reais });

    console.log(`  ${igual ? "·" : "!"} ${novela.title}`);
    console.log(`      views      ${diferenca(atual.viewCount, reais.viewCount)}`);
    console.log(
      `      favoritos  ${diferenca(atual.favoriteCount, reais.favoriteCount)}`,
    );
    console.log(
      `      assistido  ${diferenca(atual.watchedMs, reais.watchedMs)} ms`,
    );
  }

  const episodiosDivergentes = episodios.filter((episodio) => {
    const views = playsEp.get(episodio.id) ?? 0;
    const assistido = tempoEp.get(episodio.id) ?? 0;
    return episodio.viewCount !== views || Number(episodio.watchedMs) !== assistido;
  });

  console.log(
    `\n  ${alteracoes.length} de ${novelas.length} novelas divergem dos fatos.`,
  );
  console.log(
    `  ${episodiosDivergentes.length} de ${episodios.length} episódios divergem dos fatos.\n`,
  );

  if (!APLICAR) {
    console.log("  Nada foi gravado. Repita com --aplicar para corrigir.\n");
    return;
  }

  if (alteracoes.length === 0 && episodiosDivergentes.length === 0) {
    console.log("  Nada a corrigir.\n");
    return;
  }

  // Uma transação só: um catálogo meio reconciliado é pior que um catálogo
  // errado, porque ninguém sabe mais qual metade acreditar.
  await db.$transaction([
    ...alteracoes.map((alteracao) =>
      db.novela.update({
        where: { id: alteracao.id },
        data: {
          viewCount: alteracao.viewCount,
          favoriteCount: alteracao.favoriteCount,
          watchedMs: BigInt(Math.round(alteracao.watchedMs)),
        },
      }),
    ),
    ...episodiosDivergentes.map((episodio) =>
      db.episode.update({
        where: { id: episodio.id },
        data: {
          viewCount: playsEp.get(episodio.id) ?? 0,
          watchedMs: BigInt(Math.round(tempoEp.get(episodio.id) ?? 0)),
        },
      }),
    ),
  ]);

  console.log(
    `  Gravado: ${alteracoes.length} novelas e ${episodiosDivergentes.length} episódios agora refletem os fatos.\n`,
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
