import "server-only";

import { db } from "@/lib/db";
import {
  JANELA_DE_SILENCIO_MS,
  situacaoPorBatimento,
} from "@/lib/painel/servidor";

/**
 * Motor de alertas.
 *
 * Um alerta não é escrito à mão: é uma condição que passou a valer sobre
 * fatos que já estão no banco. Por isso este módulo tem duas metades bem
 * separadas — as **regras**, que só olham e descrevem, e a **reconciliação**,
 * que compara o que deveria estar aberto com o que está e ajusta a diferença.
 *
 * Três decisões que essa separação permite:
 *
 * 1. **Deduplicação por chave, não por texto.** `dedupeKey` identifica o
 *    problema, não a ocorrência. O mesmo disco enchendo pela quinta vez
 *    incrementa `occurrences` em vez de virar cinco linhas na fila.
 *
 * 2. **Fechamento automático.** Se a condição deixou de valer, o alerta se
 *    resolve sozinho e diz que foi o sistema — ninguém precisa limpar fila de
 *    problema que acabou. Alerta que só fecha na mão vira fila que ninguém lê.
 *
 * 3. **Reabertura preserva a história.** Um problema que volta reabre a mesma
 *    linha e soma ocorrências, em vez de começar do zero. "Isso já aconteceu
 *    seis vezes este mês" é a informação que resolve o caso.
 */

export type AlertaProposto = {
  dedupeKey: string;
  kind: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
  context?: Record<string, unknown>;
};

/** Acima disto, o disco é problema; acima do crítico, é urgência. */
const DISCO_ATENCAO = 0.85;
const DISCO_CRITICO = 0.94;
/** Falhas seguidas de transcodificação que caracterizam fila travada. */
const FALHAS_PARA_ALERTAR = 3;

function percentual(fracao: number): string {
  return `${Math.round(fracao * 100)}%`;
}

// ------------------------------------------------------------- as regras

/** Servidor que parou de bater. O silêncio é o próprio incidente. */
async function servidoresMudos(): Promise<AlertaProposto[]> {
  const servidores = await db.mediaServer.findMany({
    where: { enabled: true },
    select: { id: true, slug: true, name: true, lastBeatAt: true },
  });

  return servidores
    .filter(
      (servidor) =>
        servidor.lastBeatAt !== null &&
        situacaoPorBatimento(servidor.lastBeatAt) === "OFFLINE",
    )
    .map((servidor) => ({
      dedupeKey: `servidor.mudo:${servidor.slug}`,
      kind: "servidor.mudo",
      severity: "CRITICAL" as const,
      title: `${servidor.name} parou de responder`,
      detail:
        `Nenhum batimento há mais de ${Math.round(JANELA_DE_SILENCIO_MS / 60000)} minutos. ` +
        `O agente pode ter parado, a máquina pode estar desligada, ou a rede caiu. ` +
        `Enquanto durar, os números da tela de Servidor são a última leitura recebida.`,
      entityType: "MediaServer",
      entityId: servidor.id,
      context: { slug: servidor.slug, ultimoBatimento: servidor.lastBeatAt },
    }));
}

/** Disco enchendo. Vídeo acaba com espaço rápido e sem aviso. */
async function discoApertado(): Promise<AlertaProposto[]> {
  const servidores = await db.mediaServer.findMany({
    where: { enabled: true },
    select: {
      id: true,
      slug: true,
      name: true,
      beats: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { diskUsedGb: true, diskTotalGb: true },
      },
    },
  });

  const alertas: AlertaProposto[] = [];
  for (const servidor of servidores) {
    const batimento = servidor.beats[0];
    if (!batimento?.diskTotalGb || !batimento.diskUsedGb) continue;

    const ocupacao = batimento.diskUsedGb / batimento.diskTotalGb;
    if (ocupacao < DISCO_ATENCAO) continue;

    const livre = batimento.diskTotalGb - batimento.diskUsedGb;
    alertas.push({
      dedupeKey: `disco.baixo:${servidor.slug}`,
      kind: "disco.baixo",
      severity: ocupacao >= DISCO_CRITICO ? "CRITICAL" : "WARNING",
      title: `Disco de ${servidor.name} em ${percentual(ocupacao)}`,
      detail:
        `Restam ${livre.toFixed(1)} GB de ${batimento.diskTotalGb.toFixed(1)} GB. ` +
        `Transcodificação e ingestão param quando o disco enche, e param no meio.`,
      entityType: "MediaServer",
      entityId: servidor.id,
      context: {
        slug: servidor.slug,
        ocupacao: Number(ocupacao.toFixed(4)),
        livreGb: Number(livre.toFixed(2)),
      },
    });
  }
  return alertas;
}

/**
 * Mídia prometida e ausente.
 *
 * Um alerta só para o conjunto, não um por arquivo: cem episódios sem vídeo
 * são um incidente de ingestão, não cem incidentes.
 */
async function midiaAusente(): Promise<AlertaProposto[]> {
  const [sumidos, quebrados] = await Promise.all([
    db.mediaAsset.count({ where: { state: "MISSING" } }),
    db.mediaAsset.count({ where: { state: "BROKEN" } }),
  ]);

  const alertas: AlertaProposto[] = [];
  if (sumidos > 0) {
    alertas.push({
      dedupeKey: "midia.ausente",
      kind: "midia.ausente",
      severity: "CRITICAL",
      title: `${sumidos} ${sumidos === 1 ? "arquivo prometido está ausente" : "arquivos prometidos estão ausentes"}`,
      detail:
        "O catálogo aponta uma chave de mídia que a última varredura não encontrou. " +
        "Quem abrir esses episódios vê erro de reprodução.",
      entityType: "MediaAsset",
      context: { arquivos: sumidos },
    });
  }
  if (quebrados > 0) {
    alertas.push({
      dedupeKey: "midia.quebrada",
      kind: "midia.quebrada",
      severity: "WARNING",
      title: `${quebrados} ${quebrados === 1 ? "arquivo ilegível" : "arquivos ilegíveis"}`,
      detail:
        "O arquivo existe no disco, mas o ffmpeg não consegue ler os metadados. " +
        "Provável download incompleto ou container corrompido.",
      entityType: "MediaAsset",
      context: { arquivos: quebrados },
    });
  }
  return alertas;
}

/** Fila de transcodificação travando. */
async function transcodeFalhando(): Promise<AlertaProposto[]> {
  const falhas = await db.transcodeJob.count({
    where: {
      state: "FAILED",
      finishedAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  if (falhas < FALHAS_PARA_ALERTAR) return [];

  return [
    {
      dedupeKey: "transcode.falhando",
      kind: "transcode.falhando",
      severity: "WARNING",
      title: `${falhas} trabalhos de transcodificação falharam em 24 h`,
      detail:
        "Falha repetida costuma ser a mesma causa: disco cheio, arquivo de entrada " +
        "quebrado ou perfil de saída inválido. Abra a fila e leia o erro de um deles.",
      entityType: "TranscodeJob",
      context: { falhas },
    },
  ];
}

/** Erros de reprodução acima do normal — o público sente antes da operação. */
async function errosDeReproducao(): Promise<AlertaProposto[]> {
  const desde = new Date(Date.now() - 3600_000);
  const [erros, inicios] = await Promise.all([
    db.event.count({ where: { type: "PLAY_ERROR", createdAt: { gte: desde } } }),
    db.event.count({ where: { type: "PLAY_START", createdAt: { gte: desde } } }),
  ]);

  // Sem volume não há taxa: 2 erros em 3 plays é ruído, não incidente.
  if (inicios < 20 || erros === 0) return [];
  const taxa = erros / inicios;
  if (taxa < 0.1) return [];

  return [
    {
      dedupeKey: "streaming.erros",
      kind: "streaming.erros",
      severity: taxa >= 0.25 ? "CRITICAL" : "WARNING",
      title: `${percentual(taxa)} das reproduções falharam na última hora`,
      detail:
        `${erros} erros em ${inicios} tentativas. Verifique o servidor de mídia e ` +
        "os arquivos dos episódios mais tocados.",
      entityType: "Event",
      context: { erros, inicios, taxa: Number(taxa.toFixed(4)) },
    },
  ];
}

/** Todas as regras. Uma falha isolada não pode calar as outras. */
export async function avaliarRegras(): Promise<{
  propostos: AlertaProposto[];
  erros: string[];
}> {
  const regras = [
    ["servidor mudo", servidoresMudos],
    ["disco apertado", discoApertado],
    ["mídia ausente", midiaAusente],
    ["transcodificação falhando", transcodeFalhando],
    ["erros de reprodução", errosDeReproducao],
  ] as const;

  const propostos: AlertaProposto[] = [];
  const erros: string[] = [];

  for (const [nome, regra] of regras) {
    try {
      propostos.push(...(await regra()));
    } catch (erro) {
      erros.push(`${nome}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }
  return { propostos, erros };
}

// ------------------------------------------------------- a reconciliação

export type ResultadoDaAvaliacao = {
  abertos: number;
  reincidentes: number;
  resolvidos: number;
  erros: string[];
};

export async function reconciliarAlertas(): Promise<ResultadoDaAvaliacao> {
  const { propostos, erros } = await avaliarRegras();
  const agora = new Date();
  const chavesAtivas = new Set(propostos.map((a) => a.dedupeKey));

  let abertos = 0;
  let reincidentes = 0;

  for (const proposto of propostos) {
    const existente = await db.alert.findUnique({
      where: { dedupeKey: proposto.dedupeKey },
      select: { id: true, status: true, occurrences: true },
    });

    if (!existente) {
      await db.alert.create({
        data: {
          dedupeKey: proposto.dedupeKey,
          kind: proposto.kind,
          severity: proposto.severity,
          title: proposto.title,
          detail: proposto.detail ?? null,
          entityType: proposto.entityType ?? null,
          entityId: proposto.entityId ?? null,
          context: (proposto.context ?? {}) as never,
        },
      });
      abertos += 1;
      continue;
    }

    // Já resolvido e o problema voltou: reabre a mesma linha. Uma linha nova
    // perderia "isso já aconteceu seis vezes".
    const voltou = existente.status === "RESOLVED";
    await db.alert.update({
      where: { id: existente.id },
      data: {
        status: voltou ? "OPEN" : existente.status,
        severity: proposto.severity,
        title: proposto.title,
        detail: proposto.detail ?? null,
        context: (proposto.context ?? {}) as never,
        occurrences: { increment: 1 },
        lastSeenAt: agora,
        ...(voltou
          ? { resolvedAt: null, resolvedBy: null, resolvedNote: null }
          : {}),
      },
    });
    if (voltou) abertos += 1;
    else reincidentes += 1;
  }

  // Condição que deixou de valer fecha sozinha, e diz que foi o sistema.
  const paraFechar = await db.alert.findMany({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    select: { id: true, dedupeKey: true },
  });
  const fechar = paraFechar.filter((a) => !chavesAtivas.has(a.dedupeKey));

  if (fechar.length > 0) {
    await db.alert.updateMany({
      where: { id: { in: fechar.map((a) => a.id) } },
      data: {
        status: "RESOLVED",
        resolvedAt: agora,
        resolvedBy: null,
        resolvedNote: "a condição deixou de valer",
      },
    });
  }

  return { abertos, reincidentes, resolvidos: fechar.length, erros };
}
