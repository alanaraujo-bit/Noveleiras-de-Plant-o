"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";

/**
 * Gestão de bibliotecas.
 *
 * Declarar uma biblioteca é dizer "existe uma pasta nesta máquina que contém
 * conteúdo". A aplicação nunca abre esse caminho — quem o abre é o agente. Por
 * isso o painel não valida se a pasta existe: ele não tem como saber, e fingir
 * que sabe seria pior que admitir que não. A primeira varredura é quem
 * responde, e responde com a mensagem do sistema de arquivos.
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

function tratarErro(erro: unknown, contexto: string): ResultadoDaAcao {
  if (erro instanceof SemPermissao) {
    return { ok: false, erro: "Você não tem permissão para esta ação." };
  }
  void log.error({ channel: "ADMIN", message: `Falha em ${contexto}`, erro });
  return { ok: false, erro: "Não deu para concluir. Tente de novo." };
}

const bibliotecaSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  caminho: z.string().trim().min(2).max(500),
  servidorId: z.string().min(1).nullable().optional(),
  autoImport: z.boolean().default(true),
  publicarAoImportar: z.boolean().default(false),
});

export async function criarBiblioteca(
  entrada: z.infer<typeof bibliotecaSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("midia.gerenciar");
    const dados = bibliotecaSchema.parse(entrada);

    // A barra final é ruído: "D:/Novelas" e "D:/Novelas/" são a mesma pasta, e
    // deixá-las diferentes criaria duas bibliotecas para o mesmo disco.
    const caminho = dados.caminho.replace(/[\\/]+$/, "");

    const repetida = await db.mediaLibrary.findFirst({
      where: { path: caminho, serverId: dados.servidorId ?? null },
      select: { name: true },
    });
    if (repetida) {
      return {
        ok: false,
        erro: `Esta pasta já está registrada como "${repetida.name}".`,
      };
    }

    const criada = await db.mediaLibrary.create({
      data: {
        name: dados.nome,
        path: caminho,
        serverId: dados.servidorId ?? null,
        autoImport: dados.autoImport,
        publishOnImport: dados.publicarAoImportar,
      },
      select: { id: true },
    });

    await registrarAuditoria(operador, {
      action: "midia.biblioteca.criar",
      targetType: "MediaLibrary",
      targetId: criada.id,
      targetLabel: `${dados.nome} · ${caminho}`,
      after: { nome: dados.nome, caminho, autoImport: dados.autoImport },
      severity: "INFO",
    });

    revalidatePath("/painel/midia");
    return {
      ok: true,
      mensagem: `Biblioteca "${dados.nome}" registrada. Escaneie para importar.`,
    };
  } catch (erro) {
    return tratarErro(erro, "criarBiblioteca");
  }
}

const ajusteSchema = z.object({
  bibliotecaId: z.string().min(1),
  nome: z.string().trim().min(1).max(80).optional(),
  habilitada: z.boolean().optional(),
  autoImport: z.boolean().optional(),
  publicarAoImportar: z.boolean().optional(),
});

export async function ajustarBiblioteca(
  entrada: z.infer<typeof ajusteSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("midia.gerenciar");
    const dados = ajusteSchema.parse(entrada);

    const antes = await db.mediaLibrary.findUnique({
      where: { id: dados.bibliotecaId },
      select: {
        id: true,
        name: true,
        path: true,
        enabled: true,
        autoImport: true,
        publishOnImport: true,
      },
    });
    if (!antes) return { ok: false, erro: "Biblioteca não encontrada." };

    await db.mediaLibrary.update({
      where: { id: dados.bibliotecaId },
      data: {
        name: dados.nome ?? antes.name,
        enabled: dados.habilitada ?? antes.enabled,
        autoImport: dados.autoImport ?? antes.autoImport,
        publishOnImport: dados.publicarAoImportar ?? antes.publishOnImport,
      },
    });

    await registrarAuditoria(operador, {
      action: "midia.biblioteca.ajustar",
      targetType: "MediaLibrary",
      targetId: antes.id,
      targetLabel: `${antes.name} · ${antes.path}`,
      before: {
        nome: antes.name,
        habilitada: antes.enabled,
        autoImport: antes.autoImport,
      },
      after: {
        nome: dados.nome ?? antes.name,
        habilitada: dados.habilitada ?? antes.enabled,
        autoImport: dados.autoImport ?? antes.autoImport,
      },
      severity: "INFO",
    });

    revalidatePath("/painel/midia");
    return { ok: true, mensagem: "Biblioteca atualizada." };
  } catch (erro) {
    return tratarErro(erro, "ajustarBiblioteca");
  }
}

const removerSchema = z.object({
  bibliotecaId: z.string().min(1),
  motivo: z.string().trim().max(400).optional(),
});

export async function removerBiblioteca(
  entrada: z.infer<typeof removerSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("midia.gerenciar");
    const dados = removerSchema.parse(entrada);

    const antes = await db.mediaLibrary.findUnique({
      where: { id: dados.bibliotecaId },
      select: { id: true, name: true, path: true, lastEpisodes: true },
    });
    if (!antes) return { ok: false, erro: "Biblioteca não encontrada." };

    // Remover a biblioteca não apaga catálogo nem arquivo: ela é a declaração
    // de onde procurar, não a dona do conteúdo. Quem quer tirar as novelas do
    // ar faz isso no Catálogo, com a decisão à vista.
    await db.mediaLibrary.delete({ where: { id: dados.bibliotecaId } });

    await registrarAuditoria(operador, {
      action: "midia.biblioteca.remover",
      targetType: "MediaLibrary",
      targetId: antes.id,
      targetLabel: `${antes.name} · ${antes.path}`,
      before: { nome: antes.name, caminho: antes.path },
      severity: "WARNING",
      context: dados.motivo ? { motivo: dados.motivo } : {},
    });

    revalidatePath("/painel/midia");
    return {
      ok: true,
      mensagem:
        "Biblioteca removida. O catálogo e os arquivos continuam onde estavam.",
    };
  } catch (erro) {
    return tratarErro(erro, "removerBiblioteca");
  }
}

const varredaSchema = z.object({
  bibliotecaId: z.string().min(1),
  /** Relê metadados e checksum de tudo, não só do que mudou. */
  completa: z.boolean().optional(),
});

export async function pedirVarredura(
  entrada: z.infer<typeof varredaSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("midia.gerenciar");
    const dados = varredaSchema.parse(entrada);

    const biblioteca = await db.mediaLibrary.findUnique({
      where: { id: dados.bibliotecaId },
      select: { id: true, name: true, enabled: true, serverId: true },
    });
    if (!biblioteca) return { ok: false, erro: "Biblioteca não encontrada." };
    if (!biblioteca.enabled) {
      return {
        ok: false,
        erro: "Esta biblioteca está desabilitada. Habilite antes de escanear.",
      };
    }

    // Duas varreduras da mesma pasta ao mesmo tempo leriam o mesmo disco e
    // gravariam por cima uma da outra.
    const jaNaFila = await db.libraryScan.findFirst({
      where: {
        libraryId: biblioteca.id,
        state: { in: ["QUEUED", "RUNNING"] },
      },
      select: { state: true },
    });
    if (jaNaFila) {
      return {
        ok: true,
        mensagem:
          jaNaFila.state === "RUNNING"
            ? "Já existe uma varredura em andamento."
            : "Já existe uma varredura na fila.",
      };
    }

    const scan = await db.libraryScan.create({
      data: {
        libraryId: biblioteca.id,
        serverId: biblioteca.serverId,
        requestedBy: operador.id,
        full: dados.completa ?? false,
        phase: "aguardando o agente",
      },
      select: { id: true },
    });

    await registrarAuditoria(operador, {
      action: "midia.biblioteca.escanear",
      targetType: "MediaLibrary",
      targetId: biblioteca.id,
      targetLabel: biblioteca.name,
      after: { scanId: scan.id, completa: dados.completa ?? false },
      severity: "INFO",
    });

    revalidatePath("/painel/midia");
    return {
      ok: true,
      mensagem: biblioteca.serverId
        ? "Varredura na fila. O agente a pega no próximo ciclo."
        : "Varredura na fila. Rode o agente na máquina que tem os arquivos.",
    };
  } catch (erro) {
    return tratarErro(erro, "pedirVarredura");
  }
}

export async function cancelarVarredura(
  entrada: z.infer<typeof removerSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("midia.gerenciar");
    const scanId = removerSchema.parse(entrada).bibliotecaId;

    const antes = await db.libraryScan.findUnique({
      where: { id: scanId },
      select: { id: true, state: true, library: { select: { name: true } } },
    });
    if (!antes) return { ok: false, erro: "Varredura não encontrada." };
    if (antes.state !== "QUEUED" && antes.state !== "RUNNING") {
      return { ok: false, erro: "Esta varredura já terminou." };
    }

    await db.libraryScan.update({
      where: { id: scanId },
      data: { state: "CANCELED", finishedAt: new Date() },
    });

    await registrarAuditoria(operador, {
      action: "midia.varredura.cancelar",
      targetType: "LibraryScan",
      targetId: antes.id,
      targetLabel: antes.library.name,
      before: { state: antes.state },
      after: { state: "CANCELED" },
      severity: "WARNING",
    });

    revalidatePath("/painel/midia");
    return {
      ok: true,
      mensagem:
        antes.state === "RUNNING"
          ? "Cancelada. O agente para no próximo reporte."
          : "Varredura cancelada.",
    };
  } catch (erro) {
    return tratarErro(erro, "cancelarVarredura");
  }
}
