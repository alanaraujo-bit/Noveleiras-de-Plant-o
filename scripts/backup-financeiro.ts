/**
 * Copia em JSON as tabelas que a fase comercial vai tocar.
 *
 * Existe porque nao ha `pg_dump` nesta maquina e o banco de desenvolvimento e
 * o de producao. Antes de qualquer DDL, isto grava o estado em `/backups`,
 * que o `.gitignore` ja mantem fora do versionamento.
 *
 *   node --env-file=.env.local scripts/backup-financeiro.ts
 */
import { writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
const destino = `backups/financeiro-${carimbo}.json`;

const dados = {
  gravadoEm: new Date().toISOString(),
  motivo: "antes da fase de monetizacao (entitlements, planos, pagamentos)",
  users: await prisma.user.findMany(),
  subscriptions: await prisma.subscription.findMany(),
  payments: await prisma.payment.findMany(),
  // Identidade do catalogo: o suficiente para reconciliar se algo se perder.
  novelas: await prisma.novela.findMany({
    select: { id: true, slug: true, title: true, accessTier: true },
  }),
  episodes: await prisma.episode.findMany({
    select: { id: true, novelaId: true, number: true, accessTier: true },
  }),
};

await writeFile(destino, JSON.stringify(dados, null, 2), "utf8");

console.log(`gravado: ${destino}`);
console.log(
  `  users=${dados.users.length} subscriptions=${dados.subscriptions.length}` +
    ` payments=${dados.payments.length} novelas=${dados.novelas.length}` +
    ` episodes=${dados.episodes.length}`,
);

await prisma.$disconnect();
