import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * O trailer pelo servidor de mídia de verdade.
 *
 * Sem Range o player baixa o arquivo inteiro antes de mostrar o primeiro
 * quadro, e sem `video/mp4` o navegador recusa a resposta. As duas coisas já
 * valem para episódios; este teste existe porque "vale para episódio" não é
 * prova de que vale para o trailer — e o custo de descobrir isso em produção é
 * um botão que não toca nada.
 *
 * Sobe o script real, não uma imitação: um teste contra um servidor de mentira
 * não diria nada sobre o que roda na máquina de casa.
 */
const PORTA = 39_412;
const BASE = `http://127.0.0.1:${PORTA}`;
/** Corpo grande o bastante para uma faixa parcial fazer sentido. */
const CORPO = Buffer.alloc(4096, 7);

let raiz: string;
let servidor: ChildProcess;

async function esperarNoAr(tentativas = 60): Promise<void> {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const r = await fetch(`${BASE}/saude`);
      if (r.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error("o servidor de mídia não subiu");
}

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "midia-trailer-"));
  await mkdir(join(raiz, "Como domar um coroa"), { recursive: true });
  await writeFile(join(raiz, "Como domar um coroa", "trailer.mp4"), CORPO);

  servidor = spawn(
    process.execPath,
    ["scripts/servir-midia.mjs"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BIBLIOTECA_RAIZ: raiz,
        MIDIA_PORTA: String(PORTA),
      },
      stdio: "ignore",
    },
  );
  await esperarNoAr();
}, 30_000);

afterAll(async () => {
  servidor?.kill();
  await rm(raiz, { recursive: true, force: true });
});

describe("servidor de mídia · trailer", () => {
  const CHAVE = "Como domar um coroa/trailer.mp4";

  it("entrega o trailer inteiro como video/mp4 e aceita faixas", async () => {
    const r = await fetch(`${BASE}/${encodeURI(CHAVE)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect((await r.arrayBuffer()).byteLength).toBe(CORPO.length);
  });

  it("responde 206 com a faixa pedida", async () => {
    const r = await fetch(`${BASE}/${encodeURI(CHAVE)}`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-range")).toBe(`bytes 0-1023/${CORPO.length}`);
    expect(r.headers.get("content-length")).toBe("1024");
    expect((await r.arrayBuffer()).byteLength).toBe(1024);
  });

  // O player está em outro domínio: sem CORS o navegador descarta a resposta
  // mesmo com o vídeo chegando inteiro.
  it("libera CORS e expõe os cabeçalhos que o player lê", async () => {
    const r = await fetch(`${BASE}/${encodeURI(CHAVE)}`, {
      headers: { Range: "bytes=0-99" },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-expose-headers")).toContain(
      "content-range",
    );
  });

  it("recusa faixa impossível com 416, em vez de devolver lixo", async () => {
    const r = await fetch(`${BASE}/${encodeURI(CHAVE)}`, {
      headers: { Range: `bytes=${CORPO.length + 10}-` },
    });
    expect(r.status).toBe(416);
  });

  // A pasta da novela é a fronteira: nenhuma chave alcança o resto do disco.
  it("não serve nada fora da raiz da biblioteca", async () => {
    const r = await fetch(`${BASE}/../../etc/passwd`, { redirect: "manual" });
    expect(r.status).not.toBe(200);
  });
});
