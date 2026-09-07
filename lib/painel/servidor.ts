import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Autenticação do agente do servidor de mídia.
 *
 * O agente roda numa máquina que não é nossa e fala com a aplicação pela
 * internet. O segredo é gerado uma vez, mostrado uma vez e guardado como hash
 * — do mesmo jeito que uma senha, e pelo mesmo motivo: um vazamento do banco
 * não pode entregar a capacidade de forjar batimentos.
 *
 * Não usamos HMAC sobre o corpo porque o batimento não é uma ordem: ele só
 * escreve uma linha de telemetria sobre o próprio remetente. O que precisa ser
 * provado é "sou este servidor", e para isso o segredo no cabeçalho basta,
 * desde que a comparação seja em tempo constante.
 *
 * Sem `server-only`: o mesmo módulo é importado pela rota de ingestão e pelo
 * comando que registra servidores, e o comando roda fora do Next. Marcar aqui
 * quebraria a linha de comando sem proteger nada — não há segredo neste
 * arquivo, só as funções que os manipulam.
 */

export const CABECALHO_DO_SEGREDO = "x-agente-segredo";

/** Segredo novo, legível o suficiente para caber num arquivo de configuração. */
export function gerarSegredo(): string {
  return randomBytes(24).toString("base64url");
}

export function hashDoSegredo(segredo: string): string {
  return createHash("sha256").update(segredo).digest("hex");
}

/**
 * Compara em tempo constante.
 *
 * `===` em string vaza o tamanho do prefixo correto pelo tempo de resposta, e
 * um endpoint público que aceita tentativas é exatamente onde isso importa.
 */
export function segredoConfere(segredo: string, hashGravado: string): boolean {
  const calculado = Buffer.from(hashDoSegredo(segredo), "hex");
  const gravado = Buffer.from(hashGravado, "hex");
  if (calculado.length !== gravado.length) return false;
  return timingSafeEqual(calculado, gravado);
}

/**
 * Situação derivada do último batimento.
 *
 * Silêncio é informação: um servidor que parou de bater não fica "no ar" para
 * sempre só porque o último batimento dizia isso. A tela lê a situação daqui,
 * e não da coluna `status` — a coluna guarda o que o agente afirmou, esta
 * função diz o que ainda vale.
 */
export const JANELA_DE_SILENCIO_MS = 3 * 60_000;
export const JANELA_DE_ATRASO_MS = 90_000;

export function situacaoPorBatimento(
  ultimoBatimento: Date | null,
  agora = new Date(),
): "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN" {
  if (!ultimoBatimento) return "UNKNOWN";
  const silencio = agora.getTime() - ultimoBatimento.getTime();
  if (silencio > JANELA_DE_SILENCIO_MS) return "OFFLINE";
  if (silencio > JANELA_DE_ATRASO_MS) return "DEGRADED";
  return "ONLINE";
}
