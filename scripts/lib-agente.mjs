/**
 * Peças comuns dos agentes.
 *
 * Cada agente nasceu como um programa próprio, com seu terminal e seu comando
 * decorado. Isso custou caro: era fácil esquecer um no ar e descobrir horas
 * depois — uma varredura ficava "aguardando o agente" para sempre, sem que
 * nada dissesse qual dos três estava faltando.
 *
 * Agora eles também servem como peças de um agente único. Continuam
 * executáveis sozinhos (útil para depurar um deles), mas param de se
 * auto-executar quando são apenas importados.
 */
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Este módulo é o programa que o Node foi mandado rodar?
 *
 * Compara caminhos reais, e não as strings: o mesmo arquivo chega escrito de
 * formas diferentes conforme quem o invoca (barra invertida no Windows, link
 * simbólico, caminho relativo), e comparar texto daria falso negativo.
 */
export function ehOPrograma(metaUrl) {
  const invocado = process.argv[1];
  if (!invocado) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(invocado));
  } catch {
    return false;
  }
}
