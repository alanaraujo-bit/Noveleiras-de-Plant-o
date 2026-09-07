/**
 * Prévia do painel da Fase 02.
 *
 * O painel não será construído agora, mas esta fase precisa provar que ele é
 * possível sem migração. O script responde, só com os dados já gravados, cada
 * pergunta que o painel vai fazer. Se alguma resposta vier vazia por falta de
 * modelo — e não por falta de uso — é sinal de que faltou fundação.
 *
 * Uso: npm run painel:previa
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function ms(valor: number | bigint): string {
  const minutos = Number(valor) / 60_000;
  if (minutos < 60) return `${minutos.toFixed(1)} min`;
  return `${(minutos / 60).toFixed(1)} h`;
}

function bloco(titulo: string) {
  console.log(`\n── ${titulo} ${"─".repeat(Math.max(0, 58 - titulo.length))}`);
}

async function main() {
  bloco("Usuários");
  const [usuarios, ativos7d, novos7d] = await Promise.all([
    db.user.count(),
    db.user.count({
      where: { lastSeenAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
    db.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
  ]);
  console.log(`total ${usuarios} · ativos em 7 dias ${ativos7d} · novos ${novos7d}`);

  bloco("Sessões e tempo dentro da plataforma");
  const sessoes = await db.appSession.aggregate({
    _count: { _all: true },
    _sum: { durationMs: true, screenViews: true, watchedMs: true },
    _avg: { durationMs: true },
  });
  console.log(
    `sessões ${sessoes._count._all} · tempo total ${ms(sessoes._sum.durationMs ?? 0)} · ` +
      `média por sessão ${ms(sessoes._avg.durationMs ?? 0)} · telas ${sessoes._sum.screenViews ?? 0}`,
  );

  bloco("Dispositivos");
  const dispositivos = await db.appSession.groupBy({
    by: ["osName", "browser", "platform"],
    _count: { _all: true },
    orderBy: { _count: { osName: "desc" } },
    take: 5,
  });
  for (const linha of dispositivos) {
    console.log(
      `  ${linha.osName ?? "?"} / ${linha.browser ?? "?"} / ${linha.platform} — ${linha._count._all}`,
    );
  }

  bloco("Tempo assistido e progresso");
  const progresso = await db.watchProgress.aggregate({
    _count: { _all: true },
    _sum: { watchedMs: true },
    _avg: { percent: true },
  });
  const concluidos = await db.watchProgress.count({ where: { completed: true } });
  console.log(
    `episódios iniciados ${progresso._count._all} · concluídos ${concluidos} · ` +
      `tempo assistido ${ms(progresso._sum.watchedMs ?? 0)} · progresso médio ${Math.round(progresso._avg.percent ?? 0)}%`,
  );

  bloco("Novelas mais acessadas");
  const novelas = await db.novela.findMany({
    orderBy: { viewCount: "desc" },
    take: 5,
    select: { title: true, viewCount: true, favoriteCount: true, watchedMs: true },
  });
  for (const n of novelas) {
    console.log(
      `  ${n.title.padEnd(28)} acessos ${String(n.viewCount).padStart(6)} · ` +
        `lista ${n.favoriteCount} · assistido ${ms(n.watchedMs)}`,
    );
  }

  bloco("Episódios mais acessados");
  const episodios = await db.episode.findMany({
    orderBy: { viewCount: "desc" },
    take: 5,
    select: { title: true, viewCount: true, novela: { select: { title: true } } },
  });
  for (const e of episodios) {
    console.log(`  ${e.novela.title} — ${e.title} (${e.viewCount})`);
  }

  bloco("Abandono");
  // Onde as pessoas largam o episódio: base para editar duração e ritmo.
  const abandonos = await db.watchProgress.findMany({
    where: { abandonedAt: { not: null }, completed: false },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      abandonedAt: true,
      percent: true,
      episode: { select: { title: true } },
    },
  });
  if (abandonos.length === 0) console.log("  nenhum abandono registrado ainda");
  for (const a of abandonos) {
    console.log(
      `  ${a.episode.title} — largou aos ${a.abandonedAt}s (${a.percent}%)`,
    );
  }

  bloco("Buscas");
  const buscas = await db.searchQuery.groupBy({
    by: ["normalized"],
    _count: { normalized: true },
    _sum: { resultCount: true },
    orderBy: { _count: { normalized: "desc" } },
    take: 5,
  });
  if (buscas.length === 0) console.log("  nenhuma busca registrada ainda");
  for (const b of buscas) {
    console.log(
      `  “${b.normalized}” — ${b._count.normalized}x · resultados somados ${b._sum.resultCount}`,
    );
  }
  const semResultado = await db.searchQuery.count({ where: { resultCount: 0 } });
  console.log(`  buscas sem resultado: ${semResultado}`);

  bloco("Retenção (por dia de cadastro)");
  const coortes = await db.$queryRaw<{ dia: Date; total: bigint; voltaram: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS dia,
           count(*) AS total,
           count(*) FILTER (
             WHERE "lastSeenAt" > "createdAt" + interval '1 day'
           ) AS voltaram
    FROM "User"
    GROUP BY 1 ORDER BY 1 DESC LIMIT 5
  `;
  for (const c of coortes) {
    const taxa = Number(c.total) ? (Number(c.voltaram) / Number(c.total)) * 100 : 0;
    console.log(
      `  ${c.dia.toISOString().slice(0, 10)} — ${c.total} cadastros, ${c.voltaram} voltaram (${taxa.toFixed(0)}%)`,
    );
  }

  bloco("Engajamento no feed");
  const [posts, curtidas, comentarios] = await Promise.all([
    db.post.count(),
    db.postLike.count(),
    db.comment.count(),
  ]);
  console.log(`publicações ${posts} · curtidas ${curtidas} · comentários ${comentarios}`);

  bloco("Assinaturas");
  const planos = await db.subscription.groupBy({
    by: ["plan", "status"],
    _count: { _all: true },
  });
  for (const p of planos) {
    console.log(`  ${p.plan} / ${p.status} — ${p._count._all}`);
  }

  bloco("Catálogo e mídia");
  const [totalNovelas, totalEpisodios, porProvedor] = await Promise.all([
    db.novela.count(),
    db.episode.count(),
    db.episode.groupBy({ by: ["mediaProvider"], _count: { _all: true } }),
  ]);
  console.log(`novelas ${totalNovelas} · episódios ${totalEpisodios}`);
  for (const p of porProvedor) {
    console.log(`  origem ${p.mediaProvider}: ${p._count._all} episódios`);
  }

  bloco("Eventos registrados");
  const eventos = await db.event.groupBy({
    by: ["type"],
    _count: { _all: true },
    orderBy: { _count: { type: "desc" } },
  });
  const totalEventos = eventos.reduce((s, e) => s + e._count._all, 0);
  console.log(`total ${totalEventos} eventos, em ${eventos.length} tipos:`);
  for (const e of eventos) {
    console.log(`  ${e.type.padEnd(22)} ${e._count._all}`);
  }

  console.log(
    "\nTodas as perguntas do painel foram respondidas com os dados desta fase.\n",
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
