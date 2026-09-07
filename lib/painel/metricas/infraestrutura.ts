import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { Periodo } from "@/lib/painel/tempo";
import { situacaoPorBatimento } from "@/lib/painel/servidor";

/**
 * Infraestrutura: alertas, mídia, servidores e transcodificação.
 *
 * Mídia e Servidor são alimentadas: `scripts/inventariar-midia.ts` varre os
 * arquivos e `scripts/agente-midia.mjs` envia batimentos. Alertas e
 * Transcodificação ainda esperam quem escreva nelas — e as telas dizem isso
 * em vez de fingirem número.
 *
 * A medida que atravessa as duas primeiras é a distância entre o que o
 * catálogo *declara* (`Episode.mediaKey`) e o que a camada de mídia
 * *conhece* (`MediaAsset`). Continua valendo depois do inventário: ela é o
 * que denuncia arquivo prometido e ausente.
 */

// ------------------------------------------------------------- alertas

export type ResumoDeAlertas = {
  abertos: number;
  reconhecidos: number;
  resolvidos: number;
  criticos: number;
  totalRegistrado: number;
  maisAntigoAberto: Date | null;
  novosNoPeriodo: number;
};

export type LinhaDeAlerta = {
  id: string;
  tipo: string;
  titulo: string;
  detalhe: string | null;
  severidade: string;
  situacao: string;
  ocorrencias: number;
  abertoEm: Date;
  vistoEm: Date;
  reconhecidoEm: Date | null;
  resolvidoEm: Date | null;
  nota: string | null;
  entidade: string | null;
};

export async function resumoDeAlertas(
  periodo: Periodo,
): Promise<ResumoDeAlertas> {
  const [porSituacao, criticos, total, maisAntigo, novos] = await Promise.all([
    db.alert.groupBy({ by: ["status"], _count: { _all: true } }),
    db.alert.count({
      where: { severity: "CRITICAL", status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    }),
    db.alert.count(),
    db.alert.findFirst({
      where: { status: "OPEN" },
      orderBy: { openedAt: "asc" },
      select: { openedAt: true },
    }),
    db.alert.count({
      where: { openedAt: { gte: periodo.inicio, lt: periodo.fim } },
    }),
  ]);

  const mapa = new Map(
    porSituacao.map((linha) => [linha.status as string, linha._count._all]),
  );

  return {
    abertos: mapa.get("OPEN") ?? 0,
    reconhecidos: mapa.get("ACKNOWLEDGED") ?? 0,
    resolvidos: mapa.get("RESOLVED") ?? 0,
    criticos,
    totalRegistrado: total,
    maisAntigoAberto: maisAntigo?.openedAt ?? null,
    novosNoPeriodo: novos,
  };
}

export async function listarAlertas(opcoes: {
  situacao?: string;
  limite?: number;
}): Promise<LinhaDeAlerta[]> {
  const situacoes = ["OPEN", "ACKNOWLEDGED", "RESOLVED"];
  const onde: Prisma.AlertWhereInput =
    opcoes.situacao && situacoes.includes(opcoes.situacao)
      ? { status: opcoes.situacao as never }
      : {};

  const alertas = await db.alert.findMany({
    where: onde,
    // Aberto antes de reconhecido antes de resolvido; dentro de cada grupo, o
    // mais recentemente visto primeiro. Uma fila ordenada por gravidade e não
    // por data é o que separa triagem de leitura cronológica.
    orderBy: [{ status: "asc" }, { severity: "desc" }, { lastSeenAt: "desc" }],
    take: opcoes.limite ?? 50,
  });

  return alertas.map((alerta) => ({
    id: alerta.id,
    tipo: alerta.kind,
    titulo: alerta.title,
    detalhe: alerta.detail,
    severidade: alerta.severity,
    situacao: alerta.status,
    ocorrencias: alerta.occurrences,
    abertoEm: alerta.openedAt,
    vistoEm: alerta.lastSeenAt,
    reconhecidoEm: alerta.acknowledgedAt,
    resolvidoEm: alerta.resolvedAt,
    nota: alerta.resolvedNote,
    entidade: alerta.entityType
      ? `${alerta.entityType}${alerta.entityId ? ` ${alerta.entityId}` : ""}`
      : null,
  }));
}

// --------------------------------------------------------------- mídia

export type ResumoDeMidia = {
  arquivos: number;
  porEstado: { estado: string; total: number }[];
  tamanhoTotalBytes: number;
  semEpisodio: number;
  /** Episódios que declaram uma chave de mídia. */
  episodiosComChave: number;
  /** Chaves declaradas pelo catálogo que a camada de mídia não conhece. */
  chavesNaoCatalogadas: number;
  porProvedor: { provedor: string; total: number }[];
  duplicadasPorChecksum: number;
};

export async function resumoDeMidia(): Promise<ResumoDeMidia> {
  const [arquivos, porEstado, agregado, semEpisodio, episodios, chaves, duplicadas] =
    await Promise.all([
      db.mediaAsset.count(),
      db.mediaAsset.groupBy({ by: ["state"], _count: { _all: true } }),
      db.$queryRaw<{ total: number | null }[]>(Prisma.sql`
        SELECT coalesce(sum("sizeBytes"), 0)::float8 AS total FROM "MediaAsset"
      `),
      db.mediaAsset.count({ where: { episodeId: null } }),
      db.episode.findMany({ select: { mediaKey: true } }),
      db.mediaAsset.findMany({ select: { mediaKey: true } }),
      db.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total FROM (
          SELECT "checksum" FROM "MediaAsset"
          WHERE "checksum" IS NOT NULL
          GROUP BY 1 HAVING count(*) > 1
        ) AS repetidos
      `),
    ]);

  const catalogadas = new Set(chaves.map((linha) => linha.mediaKey));
  const declaradas = episodios
    .map((episodio) => episodio.mediaKey)
    .filter(Boolean);

  const porProvedor = await db.mediaAsset.groupBy({
    by: ["provider"],
    _count: { _all: true },
  });

  return {
    arquivos,
    porEstado: porEstado.map((linha) => ({
      estado: linha.state,
      total: linha._count._all,
    })),
    tamanhoTotalBytes: Number(agregado[0]?.total ?? 0),
    semEpisodio,
    episodiosComChave: declaradas.length,
    chavesNaoCatalogadas: declaradas.filter((chave) => !catalogadas.has(chave))
      .length,
    porProvedor: porProvedor.map((linha) => ({
      provedor: linha.provider,
      total: linha._count._all,
    })),
    duplicadasPorChecksum: Number(duplicadas[0]?.total ?? 0),
  };
}

export type LinhaDeMidia = {
  id: string;
  chave: string;
  variante: string;
  provedor: string;
  estado: string;
  nota: string | null;
  tamanhoBytes: number | null;
  duracaoSeg: number | null;
  resolucao: string | null;
  episodioId: string | null;
  episodio: string | null;
  ultimaVerificacao: Date | null;
};

export async function listarMidia(opcoes: {
  estado?: string;
  limite?: number;
}): Promise<LinhaDeMidia[]> {
  const estados = [
    "DISCOVERED",
    "READY",
    "PROCESSING",
    "MISSING",
    "BROKEN",
    "DUPLICATE",
  ];
  const onde: Prisma.MediaAssetWhereInput =
    opcoes.estado && estados.includes(opcoes.estado)
      ? { state: opcoes.estado as never }
      : {};

  const arquivos = await db.mediaAsset.findMany({
    where: onde,
    orderBy: { updatedAt: "desc" },
    take: opcoes.limite ?? 50,
  });
  if (arquivos.length === 0) return [];

  // `MediaAsset.episodeId` é solto por decisão: um arquivo sobrevive ao
  // episódio que o usava. Resolvido em lote, como os títulos de `Event`.
  const ids = arquivos
    .map((arquivo) => arquivo.episodeId)
    .filter((id): id is string => Boolean(id));
  const episodios = ids.length
    ? await db.episode.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true, title: true },
      })
    : [];
  const porId = new Map(episodios.map((episodio) => [episodio.id, episodio]));

  return arquivos.map((arquivo) => {
    const episodio = arquivo.episodeId ? porId.get(arquivo.episodeId) : undefined;
    return {
      id: arquivo.id,
      chave: arquivo.mediaKey,
      variante: arquivo.variant,
      provedor: arquivo.provider,
      estado: arquivo.state,
      nota: arquivo.stateNote,
      tamanhoBytes: arquivo.sizeBytes === null ? null : Number(arquivo.sizeBytes),
      duracaoSeg: arquivo.durationSec,
      resolucao:
        arquivo.width && arquivo.height
          ? `${arquivo.width}×${arquivo.height}`
          : null,
      episodioId: arquivo.episodeId,
      episodio: episodio
        ? `Ep. ${episodio.number} · ${episodio.title}`
        : arquivo.episodeId
          ? "episódio removido"
          : null,
      ultimaVerificacao: arquivo.lastProbedAt,
    };
  });
}

// ------------------------------------------------------------ servidor

export type LinhaDeServidor = {
  id: string;
  slug: string;
  nome: string;
  tipo: string;
  situacao: string;
  /** O que o agente afirmou no último batimento. */
  situacaoRelatada: string;
  habilitado: boolean;
  ultimoBatimento: Date | null;
  versaoDoAgente: string | null;
  uptimeSec: number | null;
  notas: string | null;
  ultimo: {
    cpu: number | null;
    ramUsada: number | null;
    ramTotal: number | null;
    discoUsado: number | null;
    discoTotal: number | null;
    streams: number;
    transcodes: number;
    fila: number;
  } | null;
};

export async function listarServidores(): Promise<LinhaDeServidor[]> {
  const servidores = await db.mediaServer.findMany({
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
    include: {
      beats: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return servidores.map((servidor) => {
    const batimento = servidor.beats[0];
    return {
      id: servidor.id,
      slug: servidor.slug,
      nome: servidor.name,
      tipo: servidor.kind,
      // Derivada do silêncio, não da coluna: um servidor que parou de bater
      // não continua "no ar" porque o último batimento dizia isso.
      situacao: situacaoPorBatimento(servidor.lastBeatAt),
      situacaoRelatada: servidor.status,
      habilitado: servidor.enabled,
      ultimoBatimento: servidor.lastBeatAt,
      versaoDoAgente: servidor.agentVersion,
      uptimeSec: servidor.uptimeSec,
      notas: servidor.notes,
      ultimo: batimento
        ? {
            cpu: batimento.cpuPercent,
            ramUsada: batimento.ramUsedMb,
            ramTotal: batimento.ramTotalMb,
            discoUsado: batimento.diskUsedGb,
            discoTotal: batimento.diskTotalGb,
            streams: batimento.activeStreams,
            transcodes: batimento.transcodes,
            fila: batimento.queueDepth,
          }
        : null,
    };
  });
}

export async function resumoDeServidores() {
  const [total, batimentos, ultimo] = await Promise.all([
    db.mediaServer.count(),
    db.mediaServerBeat.count(),
    db.mediaServerBeat.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return { servidores: total, batimentos, ultimoBatimento: ultimo?.createdAt ?? null };
}

// ----------------------------------------------------- transcodificação

export type ResumoDaFila = {
  naFila: number;
  rodando: number;
  concluidos: number;
  falhados: number;
  cancelados: number;
  total: number;
  concluidosNoPeriodo: number;
  falhadosNoPeriodo: number;
  tempoMedioMs: number | null;
};

export type LinhaDeTrabalho = {
  id: string;
  perfil: string;
  situacao: string;
  progresso: number;
  velocidade: number | null;
  etaSec: number | null;
  fps: number | null;
  usouGpu: boolean;
  tentativas: number;
  prioridade: number;
  erro: string | null;
  entradaKey: string | null;
  episodioId: string | null;
  enfileiradoEm: Date;
  iniciadoEm: Date | null;
  terminadoEm: Date | null;
};

export async function resumoDaFila(periodo: Periodo): Promise<ResumoDaFila> {
  const [porEstado, noPeriodo, duracao] = await Promise.all([
    db.transcodeJob.groupBy({ by: ["state"], _count: { _all: true } }),
    db.transcodeJob.groupBy({
      by: ["state"],
      where: { finishedAt: { gte: periodo.inicio, lt: periodo.fim } },
      _count: { _all: true },
    }),
    db.$queryRaw<{ media: number | null }[]>(Prisma.sql`
      SELECT avg(extract(epoch FROM ("finishedAt" - "startedAt")) * 1000)::float8
        AS media
      FROM "TranscodeJob"
      WHERE "finishedAt" IS NOT NULL AND "startedAt" IS NOT NULL
        AND "state"::text = 'DONE'
    `),
  ]);

  const mapa = new Map(
    porEstado.map((linha) => [linha.state as string, linha._count._all]),
  );
  const doPeriodo = new Map(
    noPeriodo.map((linha) => [linha.state as string, linha._count._all]),
  );

  return {
    naFila: mapa.get("QUEUED") ?? 0,
    rodando: mapa.get("RUNNING") ?? 0,
    concluidos: mapa.get("DONE") ?? 0,
    falhados: mapa.get("FAILED") ?? 0,
    cancelados: mapa.get("CANCELED") ?? 0,
    total: [...mapa.values()].reduce((soma, valor) => soma + valor, 0),
    concluidosNoPeriodo: doPeriodo.get("DONE") ?? 0,
    falhadosNoPeriodo: doPeriodo.get("FAILED") ?? 0,
    tempoMedioMs: duracao[0]?.media ?? null,
  };
}

export async function listarTrabalhos(opcoes: {
  situacao?: string;
  limite?: number;
}): Promise<LinhaDeTrabalho[]> {
  const estados = ["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELED"];
  const onde: Prisma.TranscodeJobWhereInput =
    opcoes.situacao && estados.includes(opcoes.situacao)
      ? { state: opcoes.situacao as never }
      : {};

  const trabalhos = await db.transcodeJob.findMany({
    where: onde,
    // A ordem da fila real: o que roda agora, depois o que tem prioridade,
    // depois quem chegou antes. Ordenar por data pura mentiria sobre quem sai
    // primeiro.
    orderBy: [{ state: "asc" }, { priority: "desc" }, { queuedAt: "asc" }],
    take: opcoes.limite ?? 50,
  });

  return trabalhos.map((trabalho) => ({
    id: trabalho.id,
    perfil: trabalho.profile,
    situacao: trabalho.state,
    progresso: trabalho.progress,
    velocidade: trabalho.speed,
    etaSec: trabalho.etaSec,
    fps: trabalho.fps,
    usouGpu: trabalho.gpuUsed,
    tentativas: trabalho.attempts,
    prioridade: trabalho.priority,
    erro: trabalho.error,
    entradaKey: trabalho.inputKey,
    episodioId: trabalho.episodeId,
    enfileiradoEm: trabalho.queuedAt,
    iniciadoEm: trabalho.startedAt,
    terminadoEm: trabalho.finishedAt,
  }));
}
