import { beforeEach, describe, expect, it } from "vitest";
import { lerProgressoVisitante, salvarProgressoVisitante, limparProgressoVisitante } from "./visitante";

beforeEach(() => localStorage.clear());
describe("retomada da visitante", () => {
  it("guarda o ponto e o estado de conclusão neste aparelho", () => {
    salvarProgressoVisitante({ episodeId: "ep-1", positionSec: 42, completed: false, atualizadoEm: Date.now() }, 10000);
    expect(lerProgressoVisitante()?.positionSec).toBe(42);
    expect(document.cookie).toContain("nvl_visitante_episodio=ep-1");
    salvarProgressoVisitante({ episodeId: "ep-1", positionSec: 120, completed: true, atualizadoEm: Date.now() }, 10000);
    expect(document.cookie).toContain("nvl_visitante_concluido=1");
  });
  it("ignora dados quebrados ou vencidos", () => {
    localStorage.setItem("nvl:visitante:progresso", "{");
    expect(lerProgressoVisitante()).toBeNull();
    salvarProgressoVisitante({ episodeId: "ep-1", positionSec: 42, completed: false, atualizadoEm: Date.now() - 8 * 86400000 }, 0);
    expect(lerProgressoVisitante()).toBeNull();
  });
  it("uma resposta antiga não apaga um episódio assistido depois", () => {
    salvarProgressoVisitante({ episodeId: "ep-2", positionSec: 20, completed: false, atualizadoEm: Date.now() }, 10000);
    limparProgressoVisitante("ep-1");
    expect(lerProgressoVisitante()?.episodeId).toBe("ep-2");
    limparProgressoVisitante("ep-2");
    expect(lerProgressoVisitante()).toBeNull();
  });
});
