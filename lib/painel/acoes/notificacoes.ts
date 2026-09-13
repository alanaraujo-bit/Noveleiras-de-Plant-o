"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria } from "@/lib/painel/auditoria";
import {
  baseDoApp,
  coletarRelatorio,
  ehTabelaAusente,
  lerConfig,
} from "@/lib/painel/discord/dados";
import {
  despacharNotificacoes,
  postarNoDiscord,
  URL_DE_WEBHOOK,
} from "@/lib/painel/discord/envio";
import {
  INTERVALOS,
  ultimaJanelaFechada,
  type Intervalo,
} from "@/lib/painel/discord/janelas";
import {
  LISTA_DE_EVENTOS,
  mensagemDeTeste,
  mensagemDoRelatorio,
  type MensagemDiscord,
  type TipoDeEvento,
} from "@/lib/painel/discord/mensagens";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";

/**
 * Ações da tela de Notificações.
 *
 * A URL do webhook entra por aqui e nunca volta: nenhuma destas funções a
 * devolve ao navegador. Deixar o campo vazio ao salvar mantém a atual — é o
 * que permite mexer nas caixas sem colar o segredo de novo.
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

const MIGRACAO_PENDENTE =
  "As tabelas de notificação ainda não existem neste banco — a migração precisa ser aplicada.";

function tratarErro(erro: unknown, contexto: string): ResultadoDaAcao {
  if (erro instanceof SemPermissao) {
    return { ok: false, erro: "Você não tem permissão para esta ação." };
  }
  if (ehTabelaAusente(erro)) return { ok: false, erro: MIGRACAO_PENDENTE };
  void log.error({ channel: "ADMIN", message: `Falha em ${contexto}`, erro });
  return { ok: false, erro: "Não deu para concluir. Tente de novo." };
}

const configSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(400)
    .refine((v) => v === "" || URL_DE_WEBHOOK.test(v), {
      message:
        "Isso não parece um webhook do Discord. Copie em Canal → Editar canal → Integrações → Webhooks → Copiar URL.",
    }),
  ativo: z.boolean(),
  eventos: z.array(z.enum(LISTA_DE_EVENTOS as [TipoDeEvento, ...TipoDeEvento[]])),
  relatorioAtivo: z.boolean(),
  relatorioIntervalo: z.enum(Object.keys(INTERVALOS) as [Intervalo, ...Intervalo[]]),
  relatorioHora: z.number().int().min(0).max(23),
});

export async function salvarNotificacoes(
  entrada: z.infer<typeof configSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("notificacoes.gerenciar");
    const analise = configSchema.safeParse(entrada);
    if (!analise.success) {
      return { ok: false, erro: analise.error.issues[0]?.message ?? "Dados inválidos." };
    }
    const dados = analise.data;

    const { tabelaPronta, config: antes } = await lerConfig();
    if (!tabelaPronta) return { ok: false, erro: MIGRACAO_PENDENTE };

    const webhookUrl = dados.webhookUrl || antes.webhookUrl;
    if (dados.ativo && !webhookUrl) {
      return { ok: false, erro: "Cole o webhook do canal antes de ligar." };
    }

    // O marco "daqui para frente" anda quando o canal liga ou ganha um tipo
    // novo de aviso. Sem isso, marcar "compra avulsa" hoje despejaria as
    // compras das últimas 48 horas no canal de uma vez.
    const ligou = dados.ativo && !antes.ativo;
    const ganhouTipo = dados.eventos.some((e) => !antes.eventos.includes(e));
    const agora = new Date();
    const eventosDesde =
      ligou || ganhouTipo || antes.atualizadoEm === null ? agora : antes.eventosDesde;

    const gravado = {
      webhookUrl,
      ativo: dados.ativo,
      eventos: dados.eventos,
      relatorioAtivo: dados.relatorioAtivo,
      relatorioIntervalo: dados.relatorioIntervalo,
      relatorioHora: dados.relatorioHora,
      eventosDesde,
      atualizadoPor: operador.nome,
    };

    await db.discordConfig.upsert({
      where: { id: "principal" },
      create: { id: "principal", ...gravado },
      update: gravado,
    });

    await registrarAuditoria(operador, {
      action: "notificacoes.configurar",
      targetType: "DiscordConfig",
      targetId: "principal",
      targetLabel: "Canal do Discord",
      // A URL é segredo: a auditoria registra que mudou, não qual é.
      before: {
        ativo: antes.ativo,
        eventos: antes.eventos,
        relatorioAtivo: antes.relatorioAtivo,
        relatorioIntervalo: antes.relatorioIntervalo,
        relatorioHora: antes.relatorioHora,
        temWebhook: Boolean(antes.webhookUrl),
      },
      after: {
        ativo: dados.ativo,
        eventos: dados.eventos,
        relatorioAtivo: dados.relatorioAtivo,
        relatorioIntervalo: dados.relatorioIntervalo,
        relatorioHora: dados.relatorioHora,
        temWebhook: Boolean(webhookUrl),
        webhookTrocado: Boolean(dados.webhookUrl) && dados.webhookUrl !== antes.webhookUrl,
      },
      severity: "INFO",
    });

    revalidatePath("/painel/notificacoes");
    return {
      ok: true,
      mensagem: dados.ativo
        ? "Salvo. O canal está ligado — o que estiver marcado começa a chegar."
        : "Salvo. O canal continua desligado; nada é enviado até você ligar.",
    };
  } catch (erro) {
    return tratarErro(erro, "salvarNotificacoes");
  }
}

export async function removerWebhook(): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("notificacoes.gerenciar");
    const { tabelaPronta } = await lerConfig();
    if (!tabelaPronta) return { ok: false, erro: MIGRACAO_PENDENTE };

    await db.discordConfig.updateMany({
      where: { id: "principal" },
      data: { webhookUrl: null, ativo: false, atualizadoPor: operador.nome },
    });
    await registrarAuditoria(operador, {
      action: "notificacoes.remover-webhook",
      targetType: "DiscordConfig",
      targetId: "principal",
      targetLabel: "Canal do Discord",
      severity: "WARNING",
    });
    revalidatePath("/painel/notificacoes");
    return { ok: true, mensagem: "Webhook removido e canal desligado." };
  } catch (erro) {
    return tratarErro(erro, "removerWebhook");
  }
}

/**
 * Manda uma mensagem de teste. Aceita uma URL recém-colada (ainda não salva)
 * para que dê para testar antes de gravar.
 */
export async function enviarTeste(entrada: {
  webhookUrl?: string;
}): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("notificacoes.gerenciar");
    const colada = entrada.webhookUrl?.trim();
    if (colada && !URL_DE_WEBHOOK.test(colada)) {
      return { ok: false, erro: "Isso não parece um webhook do Discord." };
    }
    const { tabelaPronta, config } = await lerConfig();
    const url = colada || config.webhookUrl;
    if (!url) return { ok: false, erro: "Cole o webhook do canal primeiro." };

    const resultado = await postarNoDiscord(url, mensagemDeTeste(operador.nome));

    if (tabelaPronta) {
      await db.discordEntrega.create({
        data: {
          chave: `teste:${Date.now()}:${operador.id}`,
          tipo: "teste",
          teste: true,
          estado: resultado.ok ? "ENVIADO" : "FALHOU",
          erro: resultado.ok ? null : resultado.erro.slice(0, 500),
          resumo: `Teste de conexão · ${operador.nome}`,
          enviadoEm: resultado.ok ? new Date() : null,
        },
      });
      revalidatePath("/painel/notificacoes");
    }

    return resultado.ok
      ? { ok: true, mensagem: "Mensagem de teste enviada. Confira o canal." }
      : { ok: false, erro: resultado.erro };
  } catch (erro) {
    return tratarErro(erro, "enviarTeste");
  }
}

/** Relatório de verdade (números reais da última janela), só que para a tela. */
export async function previaDoRelatorio(entrada: {
  intervalo: Intervalo;
  hora: number;
}): Promise<
  { ok: true; mensagem: MensagemDiscord } | { ok: false; erro: string }
> {
  try {
    await exigirPermissaoNaAcao("notificacoes.ver");
    const intervalo = entrada.intervalo in INTERVALOS ? entrada.intervalo : "diario";
    const hora = Math.min(23, Math.max(0, Math.trunc(entrada.hora)));
    const janela = ultimaJanelaFechada(intervalo, hora);
    const dados = await coletarRelatorio(janela, intervalo);
    return { ok: true, mensagem: mensagemDoRelatorio(dados, baseDoApp()) };
  } catch (erro) {
    const r = tratarErro(erro, "previaDoRelatorio");
    return { ok: false, erro: r.ok ? "" : r.erro };
  }
}

/** Força uma passagem agora, sem esperar o agendador. */
export async function verificarAgora(): Promise<ResultadoDaAcao> {
  try {
    await exigirPermissaoNaAcao("notificacoes.gerenciar");
    const r = await despacharNotificacoes();
    revalidatePath("/painel/notificacoes");
    if (r.motivo) return { ok: false, erro: `Nada enviado: ${r.motivo}.` };
    const partes = [
      r.enviados > 0 ? `${r.enviados} ${r.enviados === 1 ? "mensagem enviada" : "mensagens enviadas"}` : "nada novo para avisar",
      r.relatorio === "enviado"
        ? "relatório enviado"
        : r.relatorio === "ja-enviado"
          ? "relatório desta janela já tinha saído"
          : null,
      r.falhas > 0 ? `${r.falhas} com falha` : null,
    ].filter(Boolean);
    return r.falhas > 0
      ? { ok: false, erro: partes.join(" · ") }
      : { ok: true, mensagem: partes.join(" · ") };
  } catch (erro) {
    return tratarErro(erro, "verificarAgora");
  }
}
