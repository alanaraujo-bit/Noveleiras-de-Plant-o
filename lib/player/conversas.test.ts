/**
 * Memória das conversas por episódio.
 *
 * Abrir e fechar os comentários várias vezes não pode virar várias requisições,
 * e um erro de rede não pode virar "Ninguém comentou ainda" para sempre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  atualizarConversa,
  buscarConversa,
  conversaGuardada,
  esquecerConversas,
  VALIDADE_DA_CONVERSA_MS,
} from "./conversas";

beforeEach(() => {
  esquecerConversas();
});

describe("memória das conversas", () => {
  it("abrir duas vezes antes da resposta chegar faz uma busca só", async () => {
    let soltar: (v: string[]) => void = () => {};
    const carregar = vi.fn(
      () => new Promise<string[]>((r) => (soltar = r)),
    );

    const a = buscarConversa("ep1", carregar);
    const b = buscarConversa("ep1", carregar);
    soltar(["oi"]);

    expect(await a).toEqual(["oi"]);
    expect(await b).toEqual(["oi"]);
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("reabrir o mesmo episódio usa o que já foi lido", async () => {
    const carregar = vi.fn(async () => ["oi"]);

    await buscarConversa("ep1", carregar);
    await buscarConversa("ep1", carregar);

    expect(carregar).toHaveBeenCalledTimes(1);
    expect(conversaGuardada("ep1")).toEqual(["oi"]);
  });

  it("episódios diferentes não se misturam", async () => {
    const carregar = vi.fn(async (id: string) => [id]);

    expect(await buscarConversa("ep1", carregar)).toEqual(["ep1"]);
    expect(await buscarConversa("ep2", carregar)).toEqual(["ep2"]);
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("falha não é guardada: a próxima abertura tenta de novo", async () => {
    const carregar = vi
      .fn<(id: string) => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce(["oi"]);

    await expect(buscarConversa("ep1", carregar)).rejects.toThrow("rede");
    expect(conversaGuardada("ep1")).toBeNull();
    expect(await buscarConversa("ep1", carregar)).toEqual(["oi"]);
  });

  it("depois da validade, busca de novo", async () => {
    const carregar = vi.fn(async () => ["oi"]);
    await buscarConversa("ep1", carregar);

    const depois = Date.now() + VALIDADE_DA_CONVERSA_MS + 1;
    expect(conversaGuardada("ep1", depois)).toBeNull();
    await buscarConversa("ep1", carregar, depois);
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("o próprio comentário continua lá ao reabrir", async () => {
    await buscarConversa("ep1", async () => ["antigo"]);
    atualizarConversa<string>("ep1", (itens) => ["meu", ...itens]);

    expect(conversaGuardada("ep1")).toEqual(["meu", "antigo"]);
  });
});
