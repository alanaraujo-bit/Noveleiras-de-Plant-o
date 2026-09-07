/**
 * Prova do agente de mídia e da ingestão de batimentos.
 *
 * Exercita o caminho inteiro contra o servidor rodando: registro, autenticação
 * (aceita e recusa), gravação do batimento e — a parte que só o relógio
 * prova — a detecção de silêncio, que faz um servidor deixar de ser "no ar"
 * sem que ninguém escreva nada.
 *
 * Cria um servidor descartável com slug próprio e o remove no fim.
 *
 *   node --env-file=.env scripts/provar-agente.mjs
 */
import { PrismaClient } from "@prisma/client";

import {
  gerarSegredo,
  hashDoSegredo,
  JANELA_DE_ATRASO_MS,
  JANELA_DE_SILENCIO_MS,
  segredoConfere,
  situacaoPorBatimento,
} from "../lib/painel/servidor.ts";

const BASE = process.env.PROVA_DESTINO ?? "http://localhost:3100";
const SLUG = "prova-agente";
const db = new PrismaClient();

let falhas = 0;
function checar(condicao, descricao) {
  console.log(`  ${condicao ? "✓" : "✗"} ${descricao}`);
  if (!condicao) falhas += 1;
}

async function bater(segredo, corpo) {
  const resposta = await fetch(`${BASE}/api/agente/batimento`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(segredo ? { "x-agente-segredo": segredo } : {}),
    },
    body: JSON.stringify(corpo),
  });
  return resposta.status;
}

async function main() {
  console.log("\n  Prova do agente de mídia\n");

  // ---- funções puras: o segredo e a leitura de silêncio -----------------
  const segredo = gerarSegredo();
  const hash = hashDoSegredo(segredo);
  checar(segredoConfere(segredo, hash), "o segredo correto confere");
  checar(!segredoConfere(`${segredo}x`, hash), "um segredo alterado não confere");
  checar(!segredoConfere("", hash), "segredo vazio não confere");

  const agora = new Date();
  checar(
    situacaoPorBatimento(null, agora) === "UNKNOWN",
    "sem batimento nenhum: sem notícia",
  );
  checar(
    situacaoPorBatimento(new Date(agora.getTime() - 5_000), agora) === "ONLINE",
    "batimento recente: no ar",
  );
  checar(
    situacaoPorBatimento(
      new Date(agora.getTime() - JANELA_DE_ATRASO_MS - 1_000),
      agora,
    ) === "DEGRADED",
    "batimento atrasado: degradado",
  );
  checar(
    situacaoPorBatimento(
      new Date(agora.getTime() - JANELA_DE_SILENCIO_MS - 1_000),
      agora,
    ) === "OFFLINE",
    "silêncio prolongado: fora do ar, mesmo que o último batimento dissesse o contrário",
  );

  // ---- a rota de ingestão ----------------------------------------------
  await db.mediaServer.deleteMany({ where: { slug: SLUG } });
  await db.mediaServer.create({
    data: { slug: SLUG, name: "Servidor de prova", tokenHash: hash },
  });

  console.log("");
  checar((await bater(null, { slug: SLUG })) === 401, "sem segredo: 401");
  checar((await bater("errado", { slug: SLUG })) === 401, "segredo errado: 401");
  checar(
    (await bater(segredo, { slug: "nao-existe" })) === 401,
    "slug inexistente: 401 igual ao segredo errado, sem revelar quais existem",
  );
  checar(
    (await bater(segredo, { slug: SLUG, cpuPercent: "muito" })) === 400,
    "corpo inválido: 400",
  );

  const aceito = await bater(segredo, {
    slug: SLUG,
    agentVersion: "prova",
    cpuPercent: 12.5,
    ramUsedMb: 8000,
    ramTotalMb: 32000,
    diskUsedGb: 100,
    diskTotalGb: 500,
    activeStreams: 3,
    payload: { origem: "prova automatizada" },
  });
  checar(aceito === 200, `batimento válido: 200 (veio ${aceito})`);

  const gravado = await db.mediaServer.findUnique({
    where: { slug: SLUG },
    select: {
      status: true,
      lastBeatAt: true,
      agentVersion: true,
      beats: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  checar(gravado?.lastBeatAt !== null, "o último batimento foi carimbado");
  checar(gravado?.agentVersion === "prova", "a versão do agente foi gravada");
  const batimento = gravado?.beats[0];
  checar(batimento?.cpuPercent === 12.5, "a CPU chegou ao banco");
  checar(batimento?.activeStreams === 3, "os streams ativos chegaram ao banco");
  checar(
    batimento?.gpuPercent === null,
    "campo não enviado ficou nulo em vez de virar zero",
  );

  // ---- servidor desabilitado recusa ------------------------------------
  await db.mediaServer.update({ where: { slug: SLUG }, data: { enabled: false } });
  checar(
    (await bater(segredo, { slug: SLUG })) === 403,
    "servidor desabilitado: 403, diferente de não autorizado",
  );

  // ---- silêncio muda a leitura sem ninguém escrever --------------------
  await db.mediaServer.update({
    where: { slug: SLUG },
    data: {
      enabled: true,
      lastBeatAt: new Date(Date.now() - JANELA_DE_SILENCIO_MS - 10_000),
    },
  });
  const antigo = await db.mediaServer.findUnique({
    where: { slug: SLUG },
    select: { status: true, lastBeatAt: true },
  });
  checar(
    antigo.status === "ONLINE" &&
      situacaoPorBatimento(antigo.lastBeatAt) === "OFFLINE",
    "a coluna ainda diz ONLINE e a leitura derivada já diz fora do ar",
  );

  await db.mediaServer.delete({ where: { slug: SLUG } });
  const sobrou = await db.mediaServer.findUnique({ where: { slug: SLUG } });
  checar(sobrou === null, "servidor de prova removido");

  console.log(
    falhas === 0
      ? "\n  O caminho do agente está fechado.\n"
      : `\n  ${falhas} verificação(ões) falharam.\n`,
  );
  if (falhas > 0) process.exitCode = 1;
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
