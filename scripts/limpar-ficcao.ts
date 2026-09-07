/**
 * Remove o conteúdo de demonstração e deixa só o que é real.
 *
 * A Fase 01 semeou um catálogo inteiro de ficção para que o produto pudesse
 * ser exercitado antes de existir conteúdo. Quando o conteúdo real chega, essa
 * ficção deixa de ser andaime e vira mentira em produção — alguém abre o app e
 * vê novelas que não existem.
 *
 * O que ele considera **real**: novelas importadas de uma biblioteca do disco
 * (a nota editorial registra a pasta de origem), as contas de operação, e todo
 * fato que se refira a elas.
 *
 * O que ele considera **ficção**: as novelas do seed, as contas de vitrine
 * `@demo.noveleiras.app`, e os posts, comentários, progresso e eventos que
 * apontam para qualquer um dos dois.
 *
 * Por padrão só mostra o que faria. `--aplicar` executa, e antes disso grava
 * um despejo JSON do que vai sumir — apagar produção sem cópia é o tipo de
 * gesto que só tem uma chance de dar certo.
 *
 *   npm run limpar:ficcao
 *   npm run limpar:ficcao -- --aplicar
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const numero = new Intl.NumberFormat("pt-BR");

/** Contas de vitrine criadas pelo seed. A operação real fica de fora. */
const EMAIL_DE_DEMONSTRACAO = /@demo\.noveleiras\.app$|^demo@noveleiras\.app$/;

async function main() {
  // ---- o que é real ---------------------------------------------------
  const reais = await db.novela.findMany({
    where: { editorialNote: { contains: "Importada da pasta" } },
    select: { id: true, title: true, _count: { select: { episodes: true } } },
  });
  const idsReais = new Set(reais.map((n) => n.id));

  if (reais.length === 0) {
    console.error(
      "\n  Nenhuma novela importada de biblioteca foi encontrada." +
        "\n  Apagar a ficção agora deixaria o catálogo vazio. Importe primeiro.\n",
    );
    process.exit(1);
  }

  const ficticias = await db.novela.findMany({
    where: { id: { notIn: [...idsReais] } },
    select: { id: true, slug: true, title: true, _count: { select: { episodes: true } } },
  });
  const idsFicticios = ficticias.map((n) => n.id);

  const contasDemo = await db.user.findMany({
    where: {
      OR: [{ isDemo: true }, { email: { contains: "@demo.noveleiras.app" } }, { email: "demo@noveleiras.app" }],
    },
    select: { id: true, email: true, name: true, role: true },
  });
  // Uma conta da equipe nunca é descartável, mesmo que o e-mail pareça de
  // demonstração: quem opera o painel não pode sumir por causa de um regex.
  const paraApagar = contasDemo.filter((c) => c.role === "USER");
  const idsContas = paraApagar.map((c) => c.id);

  // ---- o que cai junto -------------------------------------------------
  const [posts, comentarios, progresso, favoritos, eventos, sessoes, buscas, assinaturas] =
    await Promise.all([
      db.post.count({
        where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
      }),
      db.comment.count({ where: { userId: { in: idsContas } } }),
      db.watchProgress.count({
        where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
      }),
      db.favorite.count({
        where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
      }),
      db.event.count({
        where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
      }),
      db.appSession.count({ where: { userId: { in: idsContas } } }),
      db.searchQuery.count({ where: { userId: { in: idsContas } } }),
      db.subscription.count({ where: { userId: { in: idsContas } } }),
    ]);

  const assetsFicticios = await db.mediaAsset.count({
    where: { mediaKey: { startsWith: "demo/" } },
  });

  // ---- o relatório -----------------------------------------------------
  console.log("\n  FICA (real)\n");
  for (const n of reais) {
    console.log(`    ${n.title} — ${n._count.episodes} episódios`);
  }
  const equipe = contasDemo.filter((c) => c.role !== "USER");
  const outras = await db.user.count({
    where: { id: { notIn: [...idsContas] } },
  });
  console.log(`\n    ${numero.format(outras)} conta(s) preservada(s)`);
  for (const c of equipe) console.log(`    (equipe protegida: ${c.email})`);

  console.log("\n  SAI (ficção)\n");
  for (const n of ficticias) {
    console.log(`    ${n.title} — ${n._count.episodes} episódios`);
  }
  console.log("");
  for (const c of paraApagar) console.log(`    conta ${c.email}`);
  console.log("");
  for (const [rotulo, total] of [
    ["publicações", posts],
    ["comentários", comentarios],
    ["progresso de reprodução", progresso],
    ["favoritos", favoritos],
    ["eventos de telemetria", eventos],
    ["sessões", sessoes],
    ["buscas", buscas],
    ["assinaturas", assinaturas],
    ["arquivos de demonstração", assetsFicticios],
  ] as const) {
    if (total > 0) console.log(`    ${numero.format(total)} ${rotulo}`);
  }

  if (!APLICAR) {
    console.log("\n  Nada foi apagado. Repita com --aplicar.\n");
    return;
  }

  // ---- cópia antes de apagar -------------------------------------------
  const pasta = join(process.cwd(), "backups");
  await mkdir(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const arquivo = join(pasta, `ficcao-${carimbo}.json`);

  const despejo = {
    geradoEm: new Date().toISOString(),
    novelas: await db.novela.findMany({
      where: { id: { in: idsFicticios } },
      include: { seasons: { include: { episodes: true } }, genres: true },
    }),
    contas: await db.user.findMany({ where: { id: { in: idsContas } } }),
    posts: await db.post.findMany({
      where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
      include: { comments: true },
    }),
  };
  await writeFile(
    arquivo,
    // BigInt não sobrevive a JSON.stringify direto.
    JSON.stringify(despejo, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 1),
  );
  console.log(`\n  Cópia gravada em ${arquivo}`);

  // ---- apagar ----------------------------------------------------------
  // A ordem respeita as dependências que o schema não apaga em cascata:
  // `Event`, `Favorite` e `WatchProgress` guardam ids soltos de novela.
  await db.$transaction([
    db.event.deleteMany({
      where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
    }),
    db.watchProgress.deleteMany({
      where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
    }),
    db.favorite.deleteMany({
      where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
    }),
    db.post.deleteMany({
      where: { OR: [{ novelaId: { in: idsFicticios } }, { userId: { in: idsContas } }] },
    }),
    db.searchQuery.deleteMany({ where: { userId: { in: idsContas } } }),
    db.mediaAsset.deleteMany({ where: { mediaKey: { startsWith: "demo/" } } }),
    // Novela em cascata leva temporadas e episódios.
    db.novela.deleteMany({ where: { id: { in: idsFicticios } } }),
    // Conta em cascata leva assinatura, sessões e o que restou dela.
    db.user.deleteMany({ where: { id: { in: idsContas } } }),
  ]);

  const restam = {
    novelas: await db.novela.count(),
    episodios: await db.episode.count(),
    contas: await db.user.count(),
    arquivos: await db.mediaAsset.count(),
  };
  console.log(
    `\n  Restam: ${restam.novelas} novelas · ${restam.episodios} episódios · ` +
      `${restam.contas} conta(s) · ${restam.arquivos} arquivos\n`,
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
