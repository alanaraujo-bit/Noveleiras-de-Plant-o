/**
 * Prova do motor de alertas e da fila de transcodificação.
 *
 * As duas peças só existem de verdade se três coisas funcionarem, e nenhuma
 * delas aparece num teste unitário:
 *
 *   1. o alerta **abre** quando a condição passa a valer;
 *   2. o mesmo problema voltando **deduplica** em vez de virar fila nova;
 *   3. o alerta **fecha sozinho** quando a condição deixa de valer.
 *
 * Na fila, a que importa é a reivindicação atômica: dois agentes pedindo ao
 * mesmo tempo, só um leva. Sem isso o mesmo episódio seria transcodificado
 * duas vezes, gravando por cima de si mesmo.
 *
 * A avaliação é disparada pela mesma rota que o agendador usa, e não por
 * importação do módulo: é a porta real, com a autenticação real.
 *
 * Cria e remove tudo o que usa. Precisa do servidor rodando em :3100 e de
 * CRON_SECRET no ambiente.
 *
 *   node --env-file=.env scripts/provar-infra.mjs
 */
import { PrismaClient } from "@prisma/client";

import { JANELA_DE_SILENCIO_MS, gerarSegredo, hashDoSegredo } from "../lib/painel/servidor.ts";

const BASE = process.env.PROVA_DESTINO ?? "http://localhost:3100";
const CRON = process.env.CRON_SECRET;
const SLUG = "prova-infra";
const db = new PrismaClient();

let falhas = 0;
function checar(condicao, descricao) {
  console.log(`  ${condicao ? "✓" : "✗"} ${descricao}`);
  if (!condicao) falhas += 1;
}

/** Dispara a avaliação pela rota do agendador. */
async function avaliar() {
  const resposta = await fetch(`${BASE}/api/cron/alertas`, {
    headers: { authorization: `Bearer ${CRON}` },
  });
  if (!resposta.ok) {
    throw new Error(`cron devolveu ${resposta.status}`);
  }
  return resposta.json();
}

async function pedirTrabalho(segredo) {
  const resposta = await fetch(`${BASE}/api/agente/trabalhos`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agente-segredo": segredo },
    body: JSON.stringify({ acao: "pegar", slug: SLUG }),
  });
  return { status: resposta.status, corpo: await resposta.json().catch(() => ({})) };
}

async function limpar(servidorId) {
  await db.transcodeJob.deleteMany({ where: { serverId: servidorId } });
  await db.alert.deleteMany({ where: { dedupeKey: { contains: SLUG } } });
  await db.mediaServer.deleteMany({ where: { slug: SLUG } });
}

async function main() {
  console.log("\n  Prova de alertas e fila\n");

  if (!CRON) {
    console.error("  CRON_SECRET ausente. Rode com --env-file=.env\n");
    process.exit(1);
  }

  // A rota tem de recusar quem não traz o segredo: um endpoint que qualquer um
  // dispara é vetor de carga, mesmo sendo só leitura.
  const semSegredo = await fetch(`${BASE}/api/cron/alertas`);
  checar(semSegredo.status === 401, "a avaliação recusa chamada sem segredo");

  const segredo = gerarSegredo();
  await db.mediaServer.deleteMany({ where: { slug: SLUG } });
  const servidor = await db.mediaServer.create({
    data: {
      slug: SLUG,
      name: "Servidor de prova",
      tokenHash: hashDoSegredo(segredo),
      // Já nasce mudo: a condição de alerta é o próprio ponto de partida.
      lastBeatAt: new Date(Date.now() - JANELA_DE_SILENCIO_MS - 60_000),
    },
    select: { id: true },
  });

  try {
    // ---- 1. abrir ------------------------------------------------------
    await avaliar();
    const aberto = await db.alert.findUnique({
      where: { dedupeKey: `servidor.mudo:${SLUG}` },
      select: { status: true, severity: true, occurrences: true },
    });
    checar(aberto?.status === "OPEN", "o silêncio abriu um alerta");
    checar(aberto?.severity === "CRITICAL", "servidor mudo é crítico");
    checar(aberto?.occurrences === 1, "primeira ocorrência conta 1");

    // ---- 2. deduplicar -------------------------------------------------
    await avaliar();
    const repetido = await db.alert.findUnique({
      where: { dedupeKey: `servidor.mudo:${SLUG}` },
      select: { occurrences: true },
    });
    checar(
      repetido?.occurrences === 2,
      `a mesma condição somou ocorrência em vez de abrir outro alerta (×${repetido?.occurrences})`,
    );
    const quantos = await db.alert.count({
      where: { dedupeKey: `servidor.mudo:${SLUG}` },
    });
    checar(quantos === 1, "continua sendo uma linha só");

    // ---- 3. fechar sozinho ---------------------------------------------
    await db.mediaServer.update({
      where: { id: servidor.id },
      data: { lastBeatAt: new Date() },
    });
    await avaliar();
    const fechado = await db.alert.findUnique({
      where: { dedupeKey: `servidor.mudo:${SLUG}` },
      select: { status: true, resolvedBy: true, resolvedNote: true },
    });
    checar(fechado?.status === "RESOLVED", "a condição deixou de valer e o alerta fechou");
    checar(
      fechado?.resolvedBy === null && Boolean(fechado?.resolvedNote),
      "fechado pelo sistema, com o motivo registrado",
    );

    // ---- 4. reabrir preserva a história --------------------------------
    await db.mediaServer.update({
      where: { id: servidor.id },
      data: { lastBeatAt: new Date(Date.now() - JANELA_DE_SILENCIO_MS - 60_000) },
    });
    await avaliar();
    const reaberto = await db.alert.findUnique({
      where: { dedupeKey: `servidor.mudo:${SLUG}` },
      select: { status: true, occurrences: true, resolvedAt: true },
    });
    checar(reaberto?.status === "OPEN", "o problema voltou e o alerta reabriu");
    checar(
      reaberto?.occurrences === 3,
      `a reabertura somou à história em vez de recomeçar (×${reaberto?.occurrences})`,
    );
    checar(reaberto?.resolvedAt === null, "a marca de resolvido foi limpa na reabertura");

    // ---- 5. reivindicação atômica --------------------------------------
    console.log("");
    await db.mediaServer.update({
      where: { id: servidor.id },
      data: { lastBeatAt: new Date() },
    });
    const trabalho = await db.transcodeJob.create({
      data: {
        profile: "480p",
        inputKey: "prova/inexistente.mp4",
        serverId: servidor.id,
      },
      select: { id: true },
    });

    // Dois pedidos simultâneos para o mesmo e único trabalho.
    const [a, b] = await Promise.all([
      pedirTrabalho(segredo),
      pedirTrabalho(segredo),
    ]);
    const levaram = [a, b].filter((r) => r.corpo?.trabalho).length;
    checar(
      levaram === 1,
      `dois agentes pediram ao mesmo tempo e só um levou (levaram ${levaram})`,
    );

    const estado = await db.transcodeJob.findUnique({
      where: { id: trabalho.id },
      select: { state: true, attempts: true, serverId: true },
    });
    checar(estado?.state === "RUNNING", "o trabalho reivindicado ficou em execução");
    checar(estado?.attempts === 1, "a tentativa foi contada uma vez só");

    // ---- 6. cancelar alcança quem está executando ----------------------
    await db.transcodeJob.update({
      where: { id: trabalho.id },
      data: { state: "CANCELED", finishedAt: new Date() },
    });
    const aviso = await fetch(`${BASE}/api/agente/trabalhos`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agente-segredo": segredo },
      body: JSON.stringify({
        acao: "progresso",
        slug: SLUG,
        jobId: trabalho.id,
        progress: 50,
      }),
    });
    const corpo = await aviso.json();
    checar(
      corpo.continuar === false,
      "o agente é avisado para parar no próximo reporte de progresso",
    );

    // ---- 7. trabalho de outro servidor não é meu ------------------------
    const alheio = await db.transcodeJob.create({
      data: { profile: "480p", inputKey: "prova/alheio.mp4", serverId: null },
      select: { id: true },
    });
    const tentativa = await fetch(`${BASE}/api/agente/trabalhos`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agente-segredo": segredo },
      body: JSON.stringify({
        acao: "encerrar",
        slug: SLUG,
        jobId: alheio.id,
        sucesso: true,
      }),
    });
    checar(
      tentativa.status === 404,
      "encerrar um trabalho que não é seu é recusado",
    );
    await db.transcodeJob.delete({ where: { id: alheio.id } });

    // ---- 8. autenticação da fila ---------------------------------------
    const semSegredo = await fetch(`${BASE}/api/agente/trabalhos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acao: "pegar", slug: SLUG }),
    });
    checar(semSegredo.status === 401, "a fila exige o mesmo segredo do batimento");
  } finally {
    await limpar(servidor.id);
  }

  const sobrou = await db.mediaServer.findUnique({ where: { slug: SLUG } });
  checar(sobrou === null, "tudo o que a prova criou foi removido");

  console.log(
    falhas === 0
      ? "\n  Alertas e fila estão fechados.\n"
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
