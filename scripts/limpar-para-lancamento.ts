/**
 * Deixa o banco pronto para o lançamento.
 *
 * Tudo o que existe até aqui é teste: contas, comentários, curtidas,
 * assinaturas, pagamentos, telemetria, logs, auditoria e alertas. O que fica é
 * o que o produto *é* — o catálogo (novelas, temporadas, episódios, elenco,
 * gêneros), a mídia e a infraestrutura (servidores, bibliotecas, arquivos,
 * planos) — e **uma** conta: a do dono.
 *
 * Por padrão só conta e mostra. `--aplicar` grava antes uma cópia integral de
 * cada linha que vai sumir em `backups/lancamento-<carimbo>/` (uma tabela por
 * arquivo, NDJSON), e só então apaga, numa transação só: ou tudo, ou nada.
 *
 *   node --env-file=.env scripts/limpar-para-lancamento.ts
 *   node --env-file=.env scripts/limpar-para-lancamento.ts --aplicar
 *
 * Opções:
 *   --historico-da-infra   apaga também batimentos do servidor, varreduras
 *                          concluídas e trabalhos de transcodificação
 *                          encerrados (o painel de Servidor recomeça do zero)
 *   --manter-assinatura-do-dono   não rebaixa a assinatura do dono para grátis
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const HISTORICO_DA_INFRA = process.argv.includes("--historico-da-infra");
const MANTER_ASSINATURA = process.argv.includes("--manter-assinatura-do-dono");

const DONO = "alanvitoraraujo1a@outlook.com";
const numero = new Intl.NumberFormat("pt-BR");

type Delegado = {
  count: (args?: unknown) => Promise<number>;
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
};

/**
 * O que é apagado, tabela por tabela, na ordem em que é apagado (filhos antes
 * dos pais — nem toda referência deste schema tem cascata).
 */
function alvos(donoId: string) {
  const tudo = {};
  const alvosBase: { tabela: string; rotulo: string; onde: object }[] = [
    { tabela: "episodeCommentLike", rotulo: "curtidas em comentários", onde: tudo },
    { tabela: "episodeLike", rotulo: "curtidas em episódios", onde: tudo },
    { tabela: "episodeComment", rotulo: "comentários de episódio", onde: tudo },
    { tabela: "postLike", rotulo: "curtidas em publicações", onde: tudo },
    { tabela: "comment", rotulo: "comentários de publicação", onde: tudo },
    { tabela: "post", rotulo: "publicações da comunidade", onde: tudo },
    { tabela: "report", rotulo: "denúncias", onde: tudo },
    { tabela: "refund", rotulo: "reembolsos", onde: tudo },
    { tabela: "payment", rotulo: "pagamentos", onde: tudo },
    { tabela: "entitlement", rotulo: "direitos de acesso", onde: tudo },
    { tabela: "paymentAttempt", rotulo: "tentativas de pagamento", onde: tudo },
    { tabela: "purchase", rotulo: "compras avulsas", onde: tudo },
    { tabela: "subscriptionEvent", rotulo: "histórico de assinaturas", onde: tudo },
    { tabela: "webhookEvent", rotulo: "webhooks recebidos", onde: tudo },
    { tabela: "event", rotulo: "eventos de telemetria", onde: tudo },
    { tabela: "searchQuery", rotulo: "buscas", onde: tudo },
    { tabela: "watchProgress", rotulo: "progresso de reprodução", onde: tudo },
    { tabela: "favorite", rotulo: "favoritos", onde: tudo },
    { tabela: "appSession", rotulo: "sessões do app", onde: tudo },
    { tabela: "adminAudit", rotulo: "registros de auditoria", onde: tudo },
    { tabela: "appLog", rotulo: "logs", onde: tudo },
    { tabela: "alert", rotulo: "alertas", onde: tudo },
    { tabela: "discordEntrega", rotulo: "envios ao Discord", onde: tudo },
  ];

  if (HISTORICO_DA_INFRA) {
    alvosBase.push(
      { tabela: "mediaServerBeat", rotulo: "batimentos do servidor", onde: tudo },
      {
        tabela: "libraryScan",
        rotulo: "varreduras encerradas",
        onde: { state: { in: ["DONE", "FAILED", "CANCELED"] } },
      },
      {
        tabela: "transcodeJob",
        rotulo: "transcodificações encerradas",
        onde: { state: { in: ["DONE", "FAILED", "CANCELED"] } },
      },
    );
  }

  // Por último: as contas. A cascata leva perfil, preferências e assinatura.
  alvosBase.push({
    tabela: "user",
    rotulo: "contas (todas menos a do dono)",
    onde: { id: { not: donoId } },
  });
  return alvosBase;
}

function delegado(tabela: string): Delegado {
  return (db as unknown as Record<string, Delegado>)[tabela];
}

const serializar = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Copia as linhas em lotes, para uma tabela grande não estourar a memória. */
async function copiar(pasta: string, tabela: string, onde: object): Promise<number> {
  const saida = createWriteStream(join(pasta, `${tabela}.ndjson`), "utf8");
  const LOTE = 2000;
  let pular = 0;
  let total = 0;
  for (;;) {
    const linhas = await delegado(tabela).findMany({
      where: onde,
      orderBy: tabela === "episodeCommentLike" || tabela === "episodeLike" || tabela === "postLike"
        ? { createdAt: "asc" }
        : { id: "asc" },
      skip: pular,
      take: LOTE,
    });
    for (const linha of linhas) saida.write(`${JSON.stringify(linha, serializar)}\n`);
    total += linhas.length;
    if (linhas.length < LOTE) break;
    pular += LOTE;
  }
  await new Promise<void>((resolve, reject) => saida.end((e?: Error | null) => (e ? reject(e) : resolve())));
  return total;
}

async function main() {
  const dono = await db.user.findUnique({
    where: { email: DONO },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!dono) {
    console.error(`\n  A conta do dono (${DONO}) não foi encontrada. Nada foi feito.\n`);
    process.exit(1);
  }
  if (dono.role !== "ADMIN") {
    console.error(`\n  A conta ${DONO} não é ADMIN — apagar o resto deixaria o painel sem dono. Nada foi feito.\n`);
    process.exit(1);
  }

  const lista = alvos(dono.id);

  // ---- o que fica -------------------------------------------------------
  const [novelas, temporadas, episodios, pessoas, generos, arquivos, servidores, bibliotecas, planos, assinaturaDoDono] =
    await Promise.all([
      db.novela.count(),
      db.season.count(),
      db.episode.count(),
      db.person.count(),
      db.genre.count(),
      db.mediaAsset.count(),
      db.mediaServer.count(),
      db.mediaLibrary.count(),
      db.plan.count(),
      db.subscription.findUnique({ where: { userId: dono.id } }),
    ]);

  console.log("\n  FICA\n");
  console.log(`    conta do dono: ${dono.name} <${dono.email}> (${dono.role})`);
  console.log(
    `    catálogo: ${numero.format(novelas)} novelas · ${numero.format(temporadas)} temporadas · ` +
      `${numero.format(episodios)} episódios · ${numero.format(pessoas)} pessoas do elenco · ${numero.format(generos)} gêneros`,
  );
  console.log(
    `    infraestrutura: ${numero.format(arquivos)} arquivos de mídia · ${numero.format(servidores)} servidor(es) · ` +
      `${numero.format(bibliotecas)} biblioteca(s) · ${numero.format(planos)} planos · configuração do Discord`,
  );
  if (!HISTORICO_DA_INFRA) {
    console.log("    histórico do servidor (batimentos, varreduras, transcodificações) — use --historico-da-infra para apagar");
  }

  // ---- o que sai --------------------------------------------------------
  console.log("\n  SAI\n");
  const contagens: { tabela: string; rotulo: string; onde: object; total: number }[] = [];
  for (const alvo of lista) {
    const total = await delegado(alvo.tabela).count({ where: alvo.onde });
    contagens.push({ ...alvo, total });
    console.log(`    ${numero.format(total).padStart(9)}  ${alvo.rotulo}`);
  }

  console.log("\n  ZERA\n");
  console.log("    contadores das novelas (acessos, favoritos, tempo assistido)");
  console.log("    contadores dos episódios (acessos, tempo, curtidas, compartilhamentos, comentários)");
  if (assinaturaDoDono && !MANTER_ASSINATURA) {
    console.log(
      `    assinatura do dono: ${assinaturaDoDono.plan}/${assinaturaDoDono.status} → FREE/ACTIVE ` +
        "(use --manter-assinatura-do-dono para não mexer)",
    );
  }

  if (!APLICAR) {
    console.log("\n  Nada foi apagado. Repita com --aplicar.\n");
    return;
  }

  // ---- cópia antes de apagar -------------------------------------------
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const pasta = join(process.cwd(), "backups", `lancamento-${carimbo}`);
  await mkdir(pasta, { recursive: true });
  console.log(`\n  Copiando para ${pasta}…`);
  for (const alvo of contagens) {
    if (alvo.total === 0) continue;
    const copiadas = await copiar(pasta, alvo.tabela, alvo.onde);
    if (copiadas !== alvo.total) {
      console.error(
        `\n  A cópia de ${alvo.tabela} tem ${copiadas} linhas, mas a contagem deu ${alvo.total}.` +
          "\n  Algo mudou durante a cópia. Nada foi apagado — rode de novo.\n",
      );
      process.exit(1);
    }
  }
  // O que é zerado também vai para a cópia, para poder voltar.
  await copiar(pasta, "novela", {});
  await copiar(pasta, "episode", {});
  if (assinaturaDoDono) await copiar(pasta, "subscription", { userId: dono.id });
  console.log("  Cópia completa.");

  // ---- apagar ----------------------------------------------------------
  await db.$transaction(
    async (tx) => {
      const t = tx as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }> }>;
      for (const alvo of contagens) {
        if (alvo.total === 0) continue;
        const { count } = await t[alvo.tabela].deleteMany({ where: alvo.onde });
        console.log(`    apagado ${numero.format(count).padStart(9)}  ${alvo.rotulo}`);
      }

      await tx.novela.updateMany({ data: { viewCount: 0, favoriteCount: 0, watchedMs: BigInt(0) } });
      await tx.episode.updateMany({
        data: { viewCount: 0, watchedMs: BigInt(0), likeCount: 0, shareCount: 0, commentCount: 0 },
      });

      if (assinaturaDoDono && !MANTER_ASSINATURA) {
        await tx.subscription.update({
          where: { userId: dono.id },
          data: {
            plan: "FREE",
            status: "ACTIVE",
            billingMode: "AUTO_RENEW",
            provider: null,
            externalCustomerId: null,
            externalId: null,
            externalPreapprovalId: null,
            priceCents: null,
            trialEndsAt: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            failedCharges: 0,
            graceUntil: null,
          },
        });
      }
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );

  const restam = {
    contas: await db.user.count(),
    novelas: await db.novela.count(),
    episodios: await db.episode.count(),
    comentarios: await db.episodeComment.count(),
    pagamentos: await db.payment.count(),
    eventos: await db.event.count(),
  };
  console.log(
    `\n  Pronto. Restam ${restam.contas} conta · ${restam.novelas} novelas · ${restam.episodios} episódios · ` +
      `${restam.comentarios} comentários · ${restam.pagamentos} pagamentos · ${restam.eventos} eventos.` +
      `\n  Cópia do que saiu: ${pasta}\n`,
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
