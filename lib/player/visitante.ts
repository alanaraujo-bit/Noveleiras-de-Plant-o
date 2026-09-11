/** Progresso deste aparelho, temporário e independente de qualquer conta. */
const CHAVE = "nvl:visitante:progresso";
const VALIDADE = 7 * 24 * 60 * 60 * 1000;
export const EVENTO_VISITANTE = "nvl:visitante:assistiu";
export type ProgressoVisitante = {
  episodeId: string;
  positionSec: number;
  completed: boolean;
  atualizadoEm: number;
};

export function lerProgressoVisitante(): ProgressoVisitante | null {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
    if (!p || typeof p.episodeId !== "string" || p.episodeId.length > 200 ||
      !Number.isFinite(p.positionSec) || p.positionSec < 0 || p.positionSec > 86400 ||
      typeof p.completed !== "boolean" || !Number.isFinite(p.atualizadoEm) ||
      Date.now() - p.atualizadoEm > VALIDADE) return null;
    return p;
  } catch { return null; }
}

export function salvarProgressoVisitante(p: ProgressoVisitante, deltaMs: number) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p));
    document.cookie = `nvl_visitante_episodio=${encodeURIComponent(p.episodeId)}; Path=/; Max-Age=604800; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.cookie = `nvl_visitante_concluido=${p.completed ? "1" : "0"}; Path=/; Max-Age=604800; SameSite=Lax`;
  } catch { /* Navegação privada pode impedir armazenamento. */ }
  window.dispatchEvent(new CustomEvent(EVENTO_VISITANTE, { detail: { deltaMs } }));
}

export function limparProgressoVisitante(episodeId: string) {
  try {
    if (lerProgressoVisitante()?.episodeId !== episodeId) return;
    localStorage.removeItem(CHAVE);
    document.cookie = "nvl_visitante_episodio=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "nvl_visitante_concluido=; Path=/; Max-Age=0; SameSite=Lax";
  } catch { /* A reprodução continua mesmo sem armazenamento. */ }
}
