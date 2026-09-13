import "server-only";

import { after } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { log } from "@/lib/painel/log";
import {
  baseDoApp,
  coletarFatos,
  coletarRelatorio,
  lerConfig,
} from "@/lib/painel/discord/dados";
import { ultimaJanelaFechada } from "@/lib/painel/discord/janelas";
import {
  EMBEDS_POR_MENSAGEM,
  fmtJanela,
  mensagemDoRelatorio,
  mensagensDosFatos,
  resumoDoFato,
  type Fato,
  type MensagemDiscord,
} from "@/lib/painel/discord/mensagens";

/**
 * Envio para o Discord.
 *
 * A regra que organiza o arquivo: **reserva antes de enviar**. Cada fato e
 * cada janela de relatório tem uma chave; inserir a linha em `DiscordEntrega`
 * é o que dá direito de postar. Se o cron e o batimento do agente passarem no
 * mesmo segundo, um deles esbarra na constraint única e desiste — a mensagem
 * sai uma vez. Enviar primeiro e gravar depois inverteria isso: dois processos
 * enviariam, e só depois descobririam que um sobrou.
 *
 * O preço dessa ordem é aceito de propósito: se o processo morrer entre
 * reservar e enviar, aquela mensagem não sai. Perder um aviso é melhor que o
 * canal repetir — repetição é justamente o que faz alguém silenciar o canal.
 */

/** Só webhooks do Discord. Um endereço qualquer aqui viraria SSRF. */
export const URL_DE_WEBHOOK =
  /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,200}$/;

const TENTATIVAS_MAXIMAS = 3;
/** Nenhum fato mais velho que isto vira aviso, mesmo que nunca tenha saído. */
const RETROATIVO_MAXIMO_MS = 48 * 3_600_000;

export type ResultadoDoPost =
  | { ok: true }
  | { ok: false; erro: string; permanente: boolean };

export async function postarNoDiscord(
  url: string,
  mensagem: MensagemDiscord,
): Promise<ResultadoDoPost> {
  if (!URL_DE_WEBHOOK.test(url)) {
    return { ok: false, erro: "Endereço de webhook inválido.", permanente: true };
  }

  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      const resposta = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mensagem),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (resposta.ok) return { ok: true };

      // Limite de taxa: o Discord diz quanto esperar. Uma espera curta e uma
      // segunda tentativa; mais que isso fica para a próxima passagem.
      if (resposta.status === 429 && tentativa === 0) {
        const corpo = (await resposta.json().catch(() => null)) as {
          retry_after?: number;
        } | null;
        const segundos = Math.min(5, Math.max(0.5, Number(corpo?.retry_after ?? 1)));
        await new Promise((r) => setTimeout(r, segundos * 1000));
        continue;
      }

      const texto = await resposta.text().catch(() => "");
      return {
        ok: false,
        erro: `Discord respondeu ${resposta.status}${texto ? `: ${texto.slice(0, 200)}` : ""}`,
        // Webhook apagado ou token errado não melhora tentando de novo.
        permanente: resposta.status === 401 || resposta.status === 404,
      };
    } catch (erro) {
      return {
        ok: false,
        erro: erro instanceof Error ? erro.message : String(erro),
        permanente: false,
      };
    }
  }
  return { ok: false, erro: "Limite de envio do Discord.", permanente: false };
}

// -------------------------------------------------------------- reserva

function ehDuplicata(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
  );
}

/** `true` = esta passagem tem o direito de enviar. */
async function reservar(
  chave: string,
  tipo: string,
  resumo: string,
): Promise<boolean> {
  try {
    await db.discordEntrega.create({ data: { chave, tipo, resumo } });
    return true;
  } catch (erro) {
    if (!ehDuplicata(erro)) throw erro;
    // Já existe. Só uma falha com tentativas sobrando volta para a fila — e o
    // `updateMany` condicional é atômico: dois processos, um vence.
    const retomada = await db.discordEntrega.updateMany({
      where: {
        chave,
        estado: "FALHOU",
        tentativas: { lt: TENTATIVAS_MAXIMAS },
      },
      data: { estado: "ENVIANDO", tentativas: { increment: 1 }, erro: null },
    });
    return retomada.count === 1;
  }
}

async function concluir(chaves: string[], resultado: ResultadoDoPost) {
  if (chaves.length === 0) return;
  await db.discordEntrega.updateMany({
    where: { chave: { in: chaves } },
    data: resultado.ok
      ? { estado: "ENVIADO", enviadoEm: new Date(), erro: null }
      : {
          estado: "FALHOU",
          erro: resultado.erro.slice(0, 500),
          // Falha permanente não é tentada de novo.
          ...(resultado.permanente ? { tentativas: TENTATIVAS_MAXIMAS } : {}),
        },
  });
}

/** Chaves que não precisam de nada: já saíram, ou esgotaram as tentativas. */
async function chavesResolvidas(chaves: string[]): Promise<Set<string>> {
  if (chaves.length === 0) return new Set();
  const linhas = await db.discordEntrega.findMany({
    where: {
      chave: { in: chaves },
      OR: [
        { estado: { in: ["ENVIADO", "ENVIANDO"] } },
        { tentativas: { gte: TENTATIVAS_MAXIMAS } },
      ],
    },
    select: { chave: true },
  });
  return new Set(linhas.map((l) => l.chave));
}

// ------------------------------------------------------------- despacho

export type ResultadoDoDespacho = {
  enviados: number;
  falhas: number;
  relatorio: "enviado" | "falhou" | "ja-enviado" | "desligado";
  motivo?: string;
};

async function executar(): Promise<ResultadoDoDespacho> {
  const { tabelaPronta, config } = await lerConfig();
  if (!tabelaPronta || !config.ativo || !config.webhookUrl) {
    return {
      enviados: 0,
      falhas: 0,
      relatorio: "desligado",
      motivo: !tabelaPronta ? "migração pendente" : "canal desligado",
    };
  }

  const url = config.webhookUrl;
  const base = baseDoApp();
  let enviados = 0;
  let falhas = 0;

  // --- avisos na hora
  if (config.eventos.length > 0) {
    const desde = new Date(
      Math.max(config.eventosDesde.getTime(), Date.now() - RETROATIVO_MAXIMO_MS),
    );
    // Os mais recentes, não os mais antigos: `desde` não anda, então pegar os
    // primeiros N travaria a fila nos mesmos N já enviados e o cadastro N+1
    // só sairia quando o primeiro caísse da janela de 48 h.
    const fatos = await coletarFatos({
      desde,
      tipos: new Set(config.eventos),
      limite: 100,
      maisRecentes: true,
    });
    const resolvidas = await chavesResolvidas(fatos.map((f) => f.chave));

    const meus: Fato[] = [];
    for (const fato of fatos) {
      if (resolvidas.has(fato.chave)) continue;
      if (await reservar(fato.chave, fato.tipo, resumoDoFato(fato))) meus.push(fato);
    }

    for (let i = 0; i < meus.length; i += EMBEDS_POR_MENSAGEM) {
      const lote = meus.slice(i, i + EMBEDS_POR_MENSAGEM);
      const [mensagem] = mensagensDosFatos(lote, base);
      const resultado = await postarNoDiscord(url, mensagem);
      await concluir(lote.map((f) => f.chave), resultado);
      if (resultado.ok) enviados += lote.length;
      else {
        falhas += lote.length;
        // Webhook morto: o resto do lote falharia igual. Devolve para a fila.
        if (resultado.permanente) {
          const resto = meus.slice(i + lote.length);
          await concluir(resto.map((f) => f.chave), resultado);
          falhas += resto.length;
          break;
        }
      }
    }
  }

  // --- relatório da última janela fechada
  let relatorio: ResultadoDoDespacho["relatorio"] = "desligado";
  if (config.relatorioAtivo) {
    const janela = ultimaJanelaFechada(config.relatorioIntervalo, config.relatorioHora);
    const chave = `relatorio:${janela.chave}`;
    const jaResolvida = (await chavesResolvidas([chave])).has(chave);

    if (jaResolvida) {
      relatorio = "ja-enviado";
    } else if (
      await reservar(chave, "relatorio", `Relatório · ${fmtJanela(janela.inicio, janela.fim)}`)
    ) {
      try {
        const dados = await coletarRelatorio(janela, config.relatorioIntervalo);
        const resultado = await postarNoDiscord(url, mensagemDoRelatorio(dados, base));
        await concluir([chave], resultado);
        relatorio = resultado.ok ? "enviado" : "falhou";
        if (resultado.ok) enviados += 1;
        else falhas += 1;
      } catch (erro) {
        await concluir([chave], {
          ok: false,
          erro: erro instanceof Error ? erro.message : String(erro),
          permanente: false,
        });
        throw erro;
      }
    } else {
      relatorio = "ja-enviado";
    }
  }

  return { enviados, falhas, relatorio };
}

// Duas chamadas simultâneas na mesma instância viram uma passagem só. Entre
// instâncias diferentes quem segura é a constraint do banco.
let emAndamento: Promise<ResultadoDoDespacho> | null = null;

export function despacharNotificacoes(): Promise<ResultadoDoDespacho> {
  if (!emAndamento) {
    emAndamento = executar().finally(() => {
      emAndamento = null;
    });
  }
  return emAndamento;
}

/**
 * Para os pontos do produto onde um fato acabou de nascer (cadastro,
 * pagamento). Roda depois da resposta, nunca atrasa quem está se cadastrando
 * e nunca lança — o mesmo contrato de `track()`.
 */
export function notificarEmSegundoPlano(origem: string): void {
  const tarefa = async () => {
    try {
      await despacharNotificacoes();
    } catch (erro) {
      void log.error({
        channel: "INTEGRATIONS",
        message: `Falha ao despachar notificações do Discord (${origem})`,
        erro,
      });
    }
  };
  try {
    after(tarefa);
  } catch {
    // Fora de uma requisição (script, teste): roda solto.
    void tarefa();
  }
}
