import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  corDoTitulo,
  dataDaEstreia,
  slugificar,
  textoDeBusca,
} from "@/lib/media/biblioteca";
import { isGeneratedArt } from "@/lib/media/resolver";

/**
 * Bibliotecas de conteúdo.
 *
 * O ciclo tem três donos e nenhum deles faz o trabalho do outro:
 *
 *   painel   declara a biblioteca e pede a varredura
 *   agente   varre o disco, lê metadados e devolve a árvore
 *   servidor importa a árvore no catálogo
 *
 * A separação não é gosto: a aplicação roda em função serverless e não
 * alcança o disco de ninguém. Quem tem o arquivo é a máquina do agente, e
 * quem tem a credencial do banco é o servidor. Nenhum dos dois precisa do
 * que o outro guarda — o agente nunca vê o banco, o servidor nunca vê o
 * disco.
 */

// ---------------------------------------------------------- o que o agente envia

/** Um episódio como o agente o encontrou. */
export type EpisodioVarrido = {
  numero: number;
  arquivo: string;
  chave: string;
  caminho: string;
  tamanhoBytes: number;
  duracaoSeg: number | null;
  largura: number | null;
  altura: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  bitrateKbps: number | null;
  fps: number | null;
  container: string | null;
  checksum: string | null;
  /** Preenchido quando o arquivo não abriu. */
  erro: string | null;
  /** Miniatura do episódio no disco. `null` = cai na arte gerada. */
  thumbChave: string | null;
  /** Estreia declarada pela origem, ISO. */
  estreadoEm: string | null;
  /** Prévia ou introdução gratuita na origem. */
  previa: boolean;
};

export type NovelaVarrida = {
  titulo: string;
  pasta: string;
  episodios: EpisodioVarrido[];
  lacunas: number[];
  ignorados: string[];
  totalDeclarado: number | null;
  origem: string | null;
  /** Sinopse da origem. `null` = ninguém escreveu ainda. */
  sinopse: string | null;
  /** Capa real no disco. `null` = arte gerada. */
  capaChave: string | null;
  /** Temas da origem, crus. Viram gênero por decisão de quem edita. */
  temas: { chave: string; valor: string }[];
  fonte: string | null;
  totalDuracaoSeg: number | null;
};

export type ResultadoDaImportacao = {
  novelasCriadas: number;
  novelasAtualizadas: number;
  episodiosCriados: number;
  episodiosAtualizados: number;
  arquivosIndexados: number;
  arquivosAusentes: number;
  bytesTotal: number;
  avisos: string[];
};

/**
 * Importa a árvore varrida no catálogo.
 *
 * Idempotente por construção: a identidade de uma novela é o slug do título e
 * a de um episódio é o número dentro da temporada. Rodar duas vezes atualiza
 * e não duplica.
 *
 * O que ela **não** faz: inventar sinopse, tagline ou elenco. Esses campos
 * nascem vazios e são preenchidos por quem sabe — um resumo adivinhado
 * enganaria quem lê o catálogo, e a tela de Catálogo mostra o que falta.
 */
export async function importarArvore(
  biblioteca: { id: string; serverId: string | null; autoImport: boolean; publishOnImport: boolean },
  novelas: NovelaVarrida[],
): Promise<ResultadoDaImportacao> {
  const resultado: ResultadoDaImportacao = {
    novelasCriadas: 0,
    novelasAtualizadas: 0,
    episodiosCriados: 0,
    episodiosAtualizados: 0,
    arquivosIndexados: 0,
    arquivosAusentes: 0,
    bytesTotal: 0,
    avisos: [],
  };

  const agora = new Date();
  const chavesVistas = new Set<string>();

  for (const novela of novelas) {
    for (const aviso of novela.ignorados) {
      resultado.avisos.push(`${novela.titulo}: ${aviso}`);
    }
    if (novela.lacunas.length > 0) {
      resultado.avisos.push(
        `${novela.titulo}: faltando ${novela.lacunas
          .map((n) => `E${String(n).padStart(2, "0")}`)
          .join(", ")}`,
      );
    }

    const slug = slugificar(novela.titulo);
    let novelaId: string | null = null;

    if (biblioteca.autoImport) {
      const existente = await db.novela.findUnique({
        where: { slug },
        select: {
          id: true,
          posterKey: true,
          heroKey: true,
          synopsis: true,
          tags: true,
        },
      });

      // Um agente mais antigo não manda estes campos. Ele continua varrendo
      // e importando; só não traz arte nem sinopse — que é exatamente o
      // estado de hoje, e não um erro.
      const sinopse = novela.sinopse ?? "";
      const capa = novela.capaChave ?? null;
      const tags = (novela.temas ?? []).map((tema) => tema.valor);

      // Arte gerada dá lugar à real: é ganho, não sobrescrita. O que uma
      // pessoa escolheu ou escreveu no painel fica de pé.
      const capaEhGerada = !existente || isGeneratedArt(existente.posterKey);
      const heroEhGerado = !existente || isGeneratedArt(existente.heroKey);
      const sinopseVazia = !existente?.synopsis?.trim();

      const gravada = await db.novela.upsert({
        where: { slug },
        create: {
          slug,
          title: novela.titulo,
          tagline: "",
          synopsis: sinopse,
          status: "ONGOING",
          accessTier: "FREE",
          year: agora.getFullYear(),
          posterKey: capa ?? `gen:capa/${slug}`,
          heroKey: capa ?? `gen:hero/${slug}`,
          accent: corDoTitulo(novela.titulo),
          tags,
          searchText: textoDeBusca(novela.titulo, sinopse, tags.join(" ")),
          editorialNote: novela.origem
            ? `Importada da pasta "${novela.pasta}" (origem ${novela.origem}).`
            : `Importada da pasta "${novela.pasta}".`,
          releasedAt: agora,
          isFeatured: false,
        },
        update: {
          title: novela.titulo,
          // A busca indexa o que fica gravado, não o que o manifesto trouxe.
          searchText: textoDeBusca(
            novela.titulo,
            sinopseVazia ? sinopse : (existente?.synopsis ?? ""),
            (existente?.tags.length ? existente.tags : tags).join(" "),
          ),
          ...(capa && capaEhGerada ? { posterKey: capa } : {}),
          ...(capa && heroEhGerado ? { heroKey: capa } : {}),
          ...(sinopse && sinopseVazia ? { synopsis: sinopse } : {}),
          ...(tags.length && !existente?.tags.length ? { tags } : {}),
        },
        select: { id: true },
      });
      novelaId = gravada.id;

      if (existente) resultado.novelasAtualizadas += 1;
      else resultado.novelasCriadas += 1;

      // A biblioteca é plana, então há uma temporada só. Ela existe porque o
      // schema exige, não porque o disco a sugere.
      const temporada = await db.season.upsert({
        where: { novelaId_number: { novelaId, number: 1 } },
        create: { novelaId, number: 1, title: "Temporada única" },
        update: {},
        select: { id: true },
      });

      for (const episodio of novela.episodios) {
        const jaExiste = await db.episode.findUnique({
          where: {
            seasonId_number: {
              seasonId: temporada.id,
              number: episodio.numero,
            },
          },
          select: { id: true, thumbKey: true },
        });

        // Miniatura própria quando existe; senão a capa da novela, que já é
        // real ou gerada conforme o caso.
        const miniatura =
          episodio.thumbChave ?? capa ?? `gen:capa/${slug}`;
        const estreia = dataDaEstreia(episodio.estreadoEm ?? null) ?? agora;

        await db.episode.upsert({
          where: {
            seasonId_number: {
              seasonId: temporada.id,
              number: episodio.numero,
            },
          },
          create: {
            seasonId: temporada.id,
            novelaId,
            number: episodio.numero,
            // A origem não tem título nem sinopse por episódio; o texto fica
            // para quem escreve a ficha no painel.
            title: `Episódio ${episodio.numero}`,
            synopsis: "",
            durationSec: Math.max(1, Math.round(episodio.duracaoSeg ?? 0)),
            mediaKey: episodio.chave,
            mediaProvider: "LOCAL",
            mediaFormat: "mp4",
            thumbKey: miniatura,
            releasedAt: estreia,
          },
          update: {
            mediaKey: episodio.chave,
            durationSec: Math.max(1, Math.round(episodio.duracaoSeg ?? 0)),
            ...(episodio.thumbChave &&
            isGeneratedArt(jaExiste?.thumbKey ?? "gen:")
              ? { thumbKey: episodio.thumbChave }
              : {}),
            ...(episodio.estreadoEm ? { releasedAt: estreia } : {}),
          },
        });

        if (jaExiste) resultado.episodiosAtualizados += 1;
        else resultado.episodiosCriados += 1;
      }
    }

    // ---- o inventário de arquivos, com ou sem catálogo -----------------
    const episodiosDaNovela = novelaId
      ? await db.episode.findMany({
          where: { novelaId },
          select: { id: true, number: true },
        })
      : [];
    const porNumero = new Map(episodiosDaNovela.map((e) => [e.number, e.id]));

    for (const episodio of novela.episodios) {
      chavesVistas.add(episodio.chave);
      resultado.bytesTotal += episodio.tamanhoBytes;
      resultado.arquivosIndexados += 1;

      const dados = {
        serverId: biblioteca.serverId,
        provider: "LOCAL" as const,
        path: episodio.caminho,
        episodeId: porNumero.get(episodio.numero) ?? null,
        isPrimary: true,
        sizeBytes: BigInt(episodio.tamanhoBytes),
        durationSec: episodio.duracaoSeg,
        width: episodio.largura,
        height: episodio.altura,
        codecVideo: episodio.codecVideo,
        codecAudio: episodio.codecAudio,
        bitrateKbps: episodio.bitrateKbps,
        frameRate: episodio.fps,
        container: episodio.container,
        checksum: episodio.checksum,
        state: episodio.erro
          ? ("BROKEN" as const)
          : episodio.duracaoSeg && episodio.largura
            ? ("READY" as const)
            : ("DISCOVERED" as const),
        stateNote: episodio.erro,
        lastProbedAt: agora,
      };

      await db.mediaAsset.upsert({
        where: {
          mediaKey_variant: { mediaKey: episodio.chave, variant: "original" },
        },
        create: { mediaKey: episodio.chave, variant: "original", ...dados },
        update: dados,
      });
    }
  }

  // ---- o que sumiu -----------------------------------------------------
  // Um arquivo que esta biblioteca conhecia e a varredura não achou vira
  // MISSING; some da pasta, não do inventário. Apagar a linha esconderia
  // exatamente o problema que a tela de Mídia existe para mostrar.
  if (biblioteca.serverId) {
    const conhecidos = await db.mediaAsset.findMany({
      where: { serverId: biblioteca.serverId, state: { not: "MISSING" } },
      select: { id: true, mediaKey: true },
    });
    const sumidos = conhecidos.filter((a) => !chavesVistas.has(a.mediaKey));

    if (sumidos.length > 0) {
      await db.mediaAsset.updateMany({
        where: { id: { in: sumidos.map((a) => a.id) } },
        data: {
          state: "MISSING",
          stateNote: "ausente na última varredura da biblioteca",
          lastProbedAt: agora,
        },
      });
      resultado.arquivosAusentes = sumidos.length;
      resultado.avisos.push(
        `${sumidos.length} arquivo(s) sumiram do disco e continuam no catálogo`,
      );
    }
  }

  return resultado;
}

// ------------------------------------------------------------- consultas

export type LinhaDeBiblioteca = {
  id: string;
  nome: string;
  caminho: string;
  habilitada: boolean;
  autoImport: boolean;
  publicarAoImportar: boolean;
  servidor: { id: string; nome: string; slug: string } | null;
  ultimaVarreduraEm: Date | null;
  ultimoEstado: string | null;
  novelas: number;
  episodios: number;
  arquivos: number;
  bytes: number;
  /** A varredura em andamento, quando há uma. */
  emAndamento: {
    id: string;
    estado: string;
    etapa: string | null;
    total: number;
    processados: number;
  } | null;
};

export async function listarBibliotecas(): Promise<LinhaDeBiblioteca[]> {
  const bibliotecas = await db.mediaLibrary.findMany({
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
    include: {
      server: { select: { id: true, name: true, slug: true } },
      scans: {
        where: { state: { in: ["QUEUED", "RUNNING"] } },
        orderBy: { queuedAt: "desc" },
        take: 1,
      },
    },
  });

  return bibliotecas.map((biblioteca) => {
    const corrente = biblioteca.scans[0];
    return {
      id: biblioteca.id,
      nome: biblioteca.name,
      caminho: biblioteca.path,
      habilitada: biblioteca.enabled,
      autoImport: biblioteca.autoImport,
      publicarAoImportar: biblioteca.publishOnImport,
      servidor: biblioteca.server
        ? {
            id: biblioteca.server.id,
            nome: biblioteca.server.name,
            slug: biblioteca.server.slug,
          }
        : null,
      ultimaVarreduraEm: biblioteca.lastScanAt,
      ultimoEstado: biblioteca.lastScanState,
      novelas: biblioteca.lastNovelas,
      episodios: biblioteca.lastEpisodes,
      arquivos: biblioteca.lastFiles,
      bytes: Number(biblioteca.lastBytes),
      emAndamento: corrente
        ? {
            id: corrente.id,
            estado: corrente.state,
            etapa: corrente.phase,
            total: corrente.totalFiles,
            processados: corrente.processedFiles,
          }
        : null,
    };
  });
}

export type LinhaDeVarredura = {
  id: string;
  biblioteca: string;
  estado: string;
  etapa: string | null;
  total: number;
  processados: number;
  novelasCriadas: number;
  episodiosCriados: number;
  arquivos: number;
  ausentes: number;
  bytes: number;
  avisos: string[];
  erro: string | null;
  pedidaEm: Date;
  iniciadaEm: Date | null;
  terminadaEm: Date | null;
};

export async function historicoDeVarreduras(
  limite = 20,
): Promise<LinhaDeVarredura[]> {
  const scans = await db.libraryScan.findMany({
    orderBy: { queuedAt: "desc" },
    take: limite,
    include: { library: { select: { name: true } } },
  });

  return scans.map((scan) => ({
    id: scan.id,
    biblioteca: scan.library.name,
    estado: scan.state,
    etapa: scan.phase,
    total: scan.totalFiles,
    processados: scan.processedFiles,
    novelasCriadas: scan.novelasCreated,
    episodiosCriados: scan.episodesCreated,
    arquivos: scan.filesIndexed,
    ausentes: scan.filesMissing,
    bytes: Number(scan.bytesTotal),
    avisos: Array.isArray(scan.warnings) ? (scan.warnings as string[]) : [],
    erro: scan.error,
    pedidaEm: scan.queuedAt,
    iniciadaEm: scan.startedAt,
    terminadaEm: scan.finishedAt,
  }));
}

/** Varreduras presas em execução sem sinal voltam para a fila. */
export const ABANDONO_DE_VARREDURA_MS = 15 * 60_000;

export async function liberarVarredurasAbandonadas(): Promise<number> {
  const resultado = await db.libraryScan.updateMany({
    where: {
      state: "RUNNING",
      startedAt: { lt: new Date(Date.now() - ABANDONO_DE_VARREDURA_MS) },
    },
    data: {
      state: "FAILED",
      error: "o agente parou de responder no meio da varredura",
      finishedAt: new Date(),
    },
  });
  return resultado.count;
}

export const SEM_SERVIDOR = Prisma.sql`"serverId" IS NULL`;
