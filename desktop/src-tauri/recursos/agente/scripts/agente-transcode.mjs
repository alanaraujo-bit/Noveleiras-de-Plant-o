/**
 * Executor de transcodificação.
 *
 * Roda ao lado do agente de batimentos, na mesma máquina que guarda os
 * arquivos. Pega um trabalho da fila, executa o ffmpeg, reporta progresso e
 * encerra — e se o painel cancelar no meio, ele para.
 *
 * Por que fica aqui e não na aplicação: transcodificar um episódio leva mais
 * tempo que a vida de uma função serverless, e o arquivo de entrada está nesta
 * máquina. Mandar o vídeo para a nuvem só para trazê-lo de volta seria pagar
 * banda duas vezes pelo mesmo resultado.
 *
 *   node --env-file=.env.agente scripts/agente-transcode.mjs
 *   node --env-file=.env.agente scripts/agente-transcode.mjs --uma-vez
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ehOPrograma } from "./lib-agente.mjs";

import ffmpegPath from "./ffmpeg.mjs";

const SLUG = process.env.AGENTE_SLUG;
const SEGREDO = process.env.AGENTE_SEGREDO;
const DESTINO = (process.env.AGENTE_DESTINO ?? "http://localhost:3100").replace(/\/$/, "");
const RAIZ = process.env.AGENTE_MIDIA ?? join(process.cwd(), "public", "media");
const OCIOSO_MS = Math.max(5, Number(process.env.AGENTE_OCIOSO ?? 20)) * 1000;
const UMA_VEZ = process.argv.includes("--uma-vez");

if (!SLUG || !SEGREDO) {
  console.error("\n  AGENTE_SLUG e AGENTE_SEGREDO são obrigatórios.\n");
  process.exit(1);
}

/**
 * Os mesmos perfis do painel.
 *
 * Duplicados aqui de propósito: o agente roda numa máquina que não importa
 * módulos da aplicação, e um agente que aceitasse argumentos vindos pela rede
 * seria execução remota de comando disfarçada de perfil.
 */
const PERFIS = {
  "720p": {
    args: ["-vf", "scale=-2:1280", "-c:v", "libx264", "-crf", "24", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k"],
    extensao: "mp4",
  },
  "480p": {
    args: ["-vf", "scale=-2:854", "-c:v", "libx264", "-crf", "26", "-preset", "veryfast", "-c:a", "aac", "-b:a", "64k"],
    extensao: "mp4",
  },
  hls: {
    args: ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-hls_time", "6", "-hls_playlist_type", "vod"],
    extensao: "m3u8",
  },
};

async function falar(corpo) {
  const resposta = await fetch(`${DESTINO}/api/agente/trabalhos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agente-segredo": SEGREDO,
    },
    body: JSON.stringify({ slug: SLUG, ...corpo }),
  });
  if (!resposta.ok) {
    throw new Error(`${resposta.status} ${(await resposta.text()).slice(0, 200)}`);
  }
  return resposta.json();
}

/** "00:01:23.45" → segundos. */
function paraSegundos(tempo) {
  const [h, m, s] = tempo.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

function executar(trabalho, entrada, saida, perfil) {
  return new Promise((resolver) => {
    const argumentos = [
      "-hide_banner",
      "-y",
      "-i",
      entrada,
      ...perfil.args,
      saida,
    ];
    const processo = spawn(ffmpegPath, argumentos);

    let duracaoTotal = null;
    let ultimoReporte = 0;
    let cancelado = false;
    let erro = "";

    processo.stderr.on("data", async (pedaco) => {
      const texto = String(pedaco);
      erro = texto.slice(-1500);

      if (duracaoTotal === null) {
        const achado = texto.match(/Duration:\s*(\d+:\d+:\d+\.\d+)/);
        if (achado) duracaoTotal = paraSegundos(achado[1]);
      }

      const tempo = texto.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (!tempo || !duracaoTotal) return;

      // Um reporte por segundo: o painel não fica mais útil com dez, e cada um
      // é uma escrita no banco.
      const agora = Date.now();
      if (agora - ultimoReporte < 1000) return;
      ultimoReporte = agora;

      const decorrido = paraSegundos(tempo[1]);
      const progresso = Math.min(99, (decorrido / duracaoTotal) * 100);
      const velocidade = texto.match(/speed=\s*([\d.]+)x/);
      const fps = texto.match(/fps=\s*([\d.]+)/);

      try {
        const resposta = await falar({
          acao: "progresso",
          jobId: trabalho.id,
          progress: Number(progresso.toFixed(1)),
          speed: velocidade ? Number(velocidade[1]) : undefined,
          fps: fps ? Number(fps[1]) : undefined,
          etaSec:
            velocidade && Number(velocidade[1]) > 0
              ? Math.round((duracaoTotal - decorrido) / Number(velocidade[1]))
              : undefined,
        });
        // Cancelamento no painel alcança o processo por aqui.
        if (resposta.continuar === false) {
          cancelado = true;
          processo.kill("SIGKILL");
        }
      } catch {
        // Rede instável não deve derrubar uma transcodificação em andamento.
      }
    });

    processo.on("close", (codigo) => {
      resolver({ codigo, cancelado, erro });
    });
    processo.on("error", (falha) => {
      resolver({ codigo: -1, cancelado, erro: falha.message });
    });
  });
}

async function umCiclo() {
  const { trabalho } = await falar({
    acao: "pegar",
    perfisSuportados: Object.keys(PERFIS),
  });
  if (!trabalho) return false;

  const perfil = PERFIS[trabalho.perfil];
  if (!perfil) {
    await falar({
      acao: "encerrar",
      jobId: trabalho.id,
      sucesso: false,
      erro: `Perfil desconhecido: ${trabalho.perfil}`,
    });
    return true;
  }

  const entrada = trabalho.entradaCaminho ?? join(RAIZ, trabalho.entradaKey ?? "");
  // A chave de saída espelha a de entrada com o perfil no caminho: quem lê
  // "demo/novela/720p/s1e1.mp4" sabe o que é sem consultar o banco.
  const partes = (trabalho.entradaKey ?? "").split("/");
  const nome = partes.pop() ?? "saida";
  const semExtensao = nome.replace(/\.[^.]+$/, "");
  const chaveSaida = [...partes, trabalho.perfil, `${semExtensao}.${perfil.extensao}`].join("/");
  const caminhoSaida = join(RAIZ, chaveSaida);

  console.log(
    `\n  ${trabalho.perfil}  ${trabalho.entradaKey}` +
      (trabalho.tentativa > 1 ? `  (tentativa ${trabalho.tentativa})` : ""),
  );

  await mkdir(dirname(caminhoSaida), { recursive: true });
  const resultado = await executar(trabalho, entrada, caminhoSaida, perfil);

  if (resultado.cancelado) {
    console.log("  cancelado pelo painel");
    return true;
  }
  if (resultado.codigo !== 0) {
    const mensagem = resultado.erro.split("\n").filter(Boolean).slice(-3).join(" ");
    console.log(`  falhou: ${mensagem.slice(0, 160)}`);
    await falar({
      acao: "encerrar",
      jobId: trabalho.id,
      sucesso: false,
      erro: mensagem,
    });
    return true;
  }

  console.log(`  pronto → ${chaveSaida}`);
  await falar({
    acao: "encerrar",
    jobId: trabalho.id,
    sucesso: true,
    outputKey: chaveSaida,
    outputs: [{ perfil: trabalho.perfil, chave: chaveSaida }],
  });
  return true;
}

async function main() {
  if (!ffmpegPath) {
    console.error("\n  ffmpeg-static não resolveu um binário.\n");
    process.exit(1);
  }

  console.log(
    `\n  executor de transcodificação · ${SLUG} → ${DESTINO}` +
      `\n  arquivos em ${RAIZ}` +
      (UMA_VEZ ? "\n" : `\n  procurando trabalho a cada ${OCIOSO_MS / 1000}s (ctrl+c para parar)\n`),
  );

  let rodando = true;
  const parar = () => {
    rodando = false;
    console.log("\n  executor encerrado\n");
    process.exit(0);
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);

  while (rodando) {
    let achou = false;
    try {
      achou = await umCiclo();
    } catch (erro) {
      console.error(`  erro no ciclo: ${erro.message}`);
    }
    if (UMA_VEZ) {
      if (!achou) console.log("  nada na fila\n");
      return;
    }
    // Só espera quando não achou nada: com fila cheia, emenda um no outro.
    if (!achou) await new Promise((r) => setTimeout(r, OCIOSO_MS));
  }
}

export { main as executar };

// Só roda sozinho quando é o programa chamado. Importado pelo agente único,
// ele é apenas mais um laço dentro do mesmo processo.
if (ehOPrograma(import.meta.url)) {
  main().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
