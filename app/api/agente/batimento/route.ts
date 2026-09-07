import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  CABECALHO_DO_SEGREDO,
  segredoConfere,
  situacaoPorBatimento,
} from "@/lib/painel/servidor";

/**
 * Recebe os batimentos do agente do servidor de mídia.
 *
 * Fica fora de `/painel` de propósito: quem chama aqui é uma máquina com um
 * segredo, não uma pessoa com sessão. As duas autoridades não se misturam — o
 * agente não alcança nada do painel, e um operador logado não consegue forjar
 * um batimento por esta rota sem o segredo do servidor.
 *
 * Todo campo é opcional menos o `slug`: um agente rodando em máquina sem GPU
 * não deve mandar zero, deve não mandar. Zero é uma medição; ausência é a
 * verdade nesse caso.
 */

const numeroOpcional = z.number().finite().nonnegative().optional();

const batimentoSchema = z.object({
  slug: z.string().min(1).max(80),
  agentVersion: z.string().max(40).optional(),
  uptimeSec: z.number().int().nonnegative().optional(),

  cpuPercent: numeroOpcional,
  ramUsedMb: z.number().int().nonnegative().optional(),
  ramTotalMb: z.number().int().nonnegative().optional(),
  gpuPercent: numeroOpcional,
  vramUsedMb: z.number().int().nonnegative().optional(),
  vramTotalMb: z.number().int().nonnegative().optional(),

  diskUsedGb: numeroOpcional,
  diskTotalGb: numeroOpcional,
  netUpKbps: numeroOpcional,
  netDownKbps: numeroOpcional,

  activeStreams: z.number().int().nonnegative().default(0),
  transcodes: z.number().int().nonnegative().default(0),
  queueDepth: z.number().int().nonnegative().default(0),
  loadAvg: numeroOpcional,

  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(requisicao: Request) {
  const segredo = requisicao.headers.get(CABECALHO_DO_SEGREDO);
  if (!segredo) {
    return NextResponse.json({ erro: "Segredo ausente" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = await requisicao.json();
  } catch {
    return NextResponse.json({ erro: "Corpo inválido" }, { status: 400 });
  }

  const analise = batimentoSchema.safeParse(corpo);
  if (!analise.success) {
    return NextResponse.json(
      { erro: "Batimento inválido", detalhe: analise.error.issues },
      { status: 400 },
    );
  }
  const dados = analise.data;

  const servidor = await db.mediaServer.findUnique({
    where: { slug: dados.slug },
    select: { id: true, tokenHash: true, enabled: true },
  });

  // Servidor inexistente e segredo errado devolvem a mesma resposta: descobrir
  // quais slugs existem não deve ser possível por tentativa.
  if (!servidor?.tokenHash || !segredoConfere(segredo, servidor.tokenHash)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }
  if (!servidor.enabled) {
    return NextResponse.json({ erro: "Servidor desabilitado" }, { status: 403 });
  }

  const agora = new Date();

  await db.$transaction([
    db.mediaServerBeat.create({
      data: {
        serverId: servidor.id,
        cpuPercent: dados.cpuPercent ?? null,
        ramUsedMb: dados.ramUsedMb ?? null,
        ramTotalMb: dados.ramTotalMb ?? null,
        gpuPercent: dados.gpuPercent ?? null,
        vramUsedMb: dados.vramUsedMb ?? null,
        vramTotalMb: dados.vramTotalMb ?? null,
        diskUsedGb: dados.diskUsedGb ?? null,
        diskTotalGb: dados.diskTotalGb ?? null,
        netUpKbps: dados.netUpKbps ?? null,
        netDownKbps: dados.netDownKbps ?? null,
        activeStreams: dados.activeStreams,
        transcodes: dados.transcodes,
        queueDepth: dados.queueDepth,
        uptimeSec: dados.uptimeSec ?? null,
        loadAvg: dados.loadAvg ?? null,
        payload: (dados.payload ?? {}) as never,
      },
    }),
    db.mediaServer.update({
      where: { id: servidor.id },
      data: {
        status: situacaoPorBatimento(agora, agora),
        lastBeatAt: agora,
        uptimeSec: dados.uptimeSec ?? null,
        agentVersion: dados.agentVersion ?? null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, recebidoEm: agora.toISOString() });
}
