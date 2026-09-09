/**
 * Reconcilia a tabela `Plan` com o catálogo em codigo.
 *
 * Idempotente: rode quantas vezes quiser. Um plano que sai do codigo e
 * **desativado**, nunca apagado — assinaturas gravadas apontam para ele, e
 * remover a linha deixaria o painel sem como renderizar o historico.
 *
 *   node --env-file=.env.local scripts/semear-planos.ts
 */
import { PrismaClient } from "@prisma/client";

import { PLANOS } from "../lib/pagamentos/planos.ts";

const prisma = new PrismaClient();

let criados = 0;
let atualizados = 0;

for (const definicao of Object.values(PLANOS)) {
  const dados = {
    name: definicao.nome,
    description: definicao.descricao,
    priceCents: definicao.precoCents,
    currency: definicao.moeda,
    interval: definicao.intervalo,
    intervalCount: definicao.intervaloCount,
    entitlementKind: definicao.entitlementKind,
    active: definicao.ativo,
    sortOrder: definicao.ordem,
  };

  const existente = await prisma.plan.findUnique({
    where: { code: definicao.code },
  });

  if (existente) {
    await prisma.plan.update({ where: { code: definicao.code }, data: dados });
    atualizados += 1;
  } else {
    await prisma.plan.create({ data: { code: definicao.code, ...dados } });
    criados += 1;
  }

  console.log(
    `  ${definicao.code.padEnd(8)} ${definicao.nome.padEnd(20)} ` +
      `${(definicao.precoCents / 100).toFixed(2).padStart(7)} ` +
      `${definicao.ativo ? "ativo" : "inativo"}`,
  );
}

console.log(`\nplanos criados: ${criados} | atualizados: ${atualizados}`);

await prisma.$disconnect();
