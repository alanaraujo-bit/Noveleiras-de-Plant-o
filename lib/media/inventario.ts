import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const executar = promisify(execFile);

/**
 * Leitura de um arquivo de mídia no disco.
 *
 * Isolado do script que o chama porque a varredura vai rodar em dois lugares:
 * o comando manual de hoje e o agente do servidor de mídia amanhã. Os dois
 * precisam produzir exatamente o mesmo `MediaAsset`, ou o inventário passa a
 * depender de quem o preencheu.
 *
 * Nada aqui inventa valor: um campo que o `ffmpeg` não conseguiu ler volta
 * nulo. Um vídeo com metadado ausente é um fato sobre o arquivo, e a tela de
 * mídia existe justamente para mostrar esse tipo de coisa.
 */

export type ArquivoDeMidia = {
  /** Caminho relativo à raiz, com barras normais — é a `mediaKey`. */
  chave: string;
  caminho: string;
  tamanhoBytes: number;
  modificadoEm: Date;
};

// `.ts` é MPEG-TS: vídeo legítimo que o navegador não toca direto. Entra no
// inventário porque existe no disco; a conversão para MP4 é outro passo.
const EXTENSOES = new Set([
  ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".m3u8", ".ts", ".mts", ".m2ts",
]);

/** Varre a raiz recursivamente e devolve os arquivos de vídeo encontrados. */
export async function varrer(raiz: string): Promise<ArquivoDeMidia[]> {
  const encontrados: ArquivoDeMidia[] = [];

  async function descer(diretorio: string) {
    const entradas = await readdir(diretorio, { withFileTypes: true });
    for (const entrada of entradas) {
      const caminho = join(diretorio, entrada.name);
      // Pastas ocultas são material de trabalho (o gerador de demo deixa
      // `.fundos` para trás); inventariá-las seria catalogar rascunho.
      if (entrada.name.startsWith(".")) continue;
      if (entrada.isDirectory()) {
        await descer(caminho);
        continue;
      }
      const ponto = entrada.name.lastIndexOf(".");
      const extensao = ponto === -1 ? "" : entrada.name.slice(ponto).toLowerCase();
      if (!EXTENSOES.has(extensao)) continue;

      const info = await stat(caminho);
      encontrados.push({
        chave: relative(raiz, caminho).split(sep).join("/"),
        caminho,
        tamanhoBytes: info.size,
        modificadoEm: info.mtime,
      });
    }
  }

  await descer(raiz);
  return encontrados.sort((a, b) => a.chave.localeCompare(b.chave));
}

export type Sondagem = {
  duracaoSeg: number | null;
  largura: number | null;
  altura: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  bitrateKbps: number | null;
  fps: number | null;
  container: string | null;
  /** Motivo pelo qual a leitura falhou, quando falhou. */
  erro: string | null;
};

const VAZIA: Sondagem = {
  duracaoSeg: null,
  largura: null,
  altura: null,
  codecVideo: null,
  codecAudio: null,
  bitrateKbps: null,
  fps: null,
  container: null,
  erro: null,
};

/**
 * Metadados do arquivo, lidos pelo `ffmpeg`.
 *
 * Usamos o próprio `ffmpeg` em vez do `ffprobe`: o binário já é dependência do
 * projeto e, chamado sem saída, ele imprime o cabeçalho do arquivo em stderr e
 * sai com erro — que é o caminho normal, não uma falha.
 */
export async function sondar(
  caminho: string,
  binarioFfmpeg: string,
): Promise<Sondagem> {
  let saida: string;
  try {
    const resultado = await executar(binarioFfmpeg, ["-hide_banner", "-i", caminho]);
    saida = resultado.stderr;
  } catch (erro) {
    const comSaida = erro as { stderr?: string };
    saida = comSaida.stderr ?? "";
    if (!saida) {
      return { ...VAZIA, erro: "ffmpeg não devolveu metadados" };
    }
  }

  // Um arquivo que o ffmpeg não abre é um arquivo quebrado — e saber disso é
  // metade do motivo de existir um inventário.
  if (/Invalid data found|moov atom not found|No such file/i.test(saida)) {
    const linha = saida
      .split("\n")
      .find((l) => /Invalid data found|moov atom not found|No such file/i.test(l));
    return { ...VAZIA, erro: (linha ?? "arquivo ilegível").trim() };
  }

  const duracao = saida.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const bitrate = saida.match(/bitrate:\s*(\d+)\s*kb\/s/);
  const video = saida.match(
    /Stream #\d+:\d+.*?: Video:\s*([a-zA-Z0-9_]+).*?,\s*(\d{2,5})x(\d{2,5})/,
  );
  const audio = saida.match(/Stream #\d+:\d+.*?: Audio:\s*([a-zA-Z0-9_]+)/);
  const fps = saida.match(/,\s*([\d.]+)\s*fps/);
  const container = saida.match(/Input #0,\s*([^,]+),/);

  return {
    duracaoSeg: duracao
      ? Number(duracao[1]) * 3600 + Number(duracao[2]) * 60 + Number(duracao[3])
      : null,
    largura: video ? Number(video[2]) : null,
    altura: video ? Number(video[3]) : null,
    codecVideo: video ? video[1] : null,
    codecAudio: audio ? audio[1] : null,
    bitrateKbps: bitrate ? Number(bitrate[1]) : null,
    fps: fps ? Number(fps[1]) : null,
    // "mov,mp4,m4a,3gp,3g2,mj2" — o primeiro nome basta como rótulo.
    container: container ? container[1].split(",")[0].trim() : null,
    erro: null,
  };
}

/**
 * Checksum do conteúdo.
 *
 * Em fluxo, porque um catálogo de vídeo não cabe na memória. É o que permite
 * detectar duplicata por conteúdo em vez de por nome — dois arquivos com nomes
 * diferentes e o mesmo hash são o mesmo vídeo ocupando espaço duas vezes.
 */
export function calcularChecksum(caminho: string): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const hash = createHash("sha256");
    const fluxo = createReadStream(caminho);
    fluxo.on("data", (pedaco) => hash.update(pedaco));
    fluxo.on("error", rejeitar);
    fluxo.on("end", () => resolver(hash.digest("hex")));
  });
}

/**
 * Estado do arquivo a partir do que a sondagem conseguiu ler.
 *
 * `READY` exige duração e dimensões: um vídeo que o player não consegue medir
 * não está pronto para servir, mesmo existindo no disco.
 */
export function estadoDoArquivo(
  sondagem: Sondagem,
): "READY" | "BROKEN" | "DISCOVERED" {
  if (sondagem.erro) return "BROKEN";
  if (sondagem.duracaoSeg && sondagem.largura && sondagem.altura) return "READY";
  return "DISCOVERED";
}
