/**
 * Agente do servidor de mídia.
 *
 * Roda na máquina que guarda e serve os vídeos, e manda um batimento por
 * minuto para o painel: CPU, memória, disco, rede e quantos streams estão
 * abertos. É o que transforma a tela de Servidor em uma leitura de estado real
 * em vez de um formulário vazio.
 *
 * Depende apenas do Node — nada de biblioteca nativa, porque a máquina que
 * serve mídia não deve precisar de um ambiente de compilação para ser
 * observada. O que o Node não expõe (GPU, por exemplo) não é enviado: campo
 * ausente é mais honesto que zero inventado.
 *
 * Configuração em `.env.agente`, na máquina:
 *
 *     AGENTE_SLUG="casa"
 *     AGENTE_SEGREDO="..."
 *     AGENTE_DESTINO="https://noveleiras-de-plantao.vercel.app"
 *     AGENTE_MIDIA="D:/videos"        # opcional: pasta cujo disco medir
 *     AGENTE_INTERVALO="60"           # opcional: segundos entre batimentos
 *
 *     node --env-file=.env.agente scripts/agente-midia.mjs
 *     node --env-file=.env.agente scripts/agente-midia.mjs --uma-vez
 */
import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { ehOPrograma } from "./lib-agente.mjs";

const executar = promisify(execFile);

const VERSAO = "1.0.0";
const SLUG = process.env.AGENTE_SLUG;
const SEGREDO = process.env.AGENTE_SEGREDO;
const DESTINO = (process.env.AGENTE_DESTINO ?? "http://localhost:3100").replace(/\/$/, "");
const PASTA = process.env.AGENTE_MIDIA ?? process.cwd();
const INTERVALO_MS = Math.max(15, Number(process.env.AGENTE_INTERVALO ?? 60)) * 1000;
const UMA_VEZ = process.argv.includes("--uma-vez");

if (!SLUG || !SEGREDO) {
  console.error(
    "\n  AGENTE_SLUG e AGENTE_SEGREDO são obrigatórios." +
      "\n  Registre o servidor no painel:  npm run servidor -- registrar <slug> \"<nome>\"\n",
  );
  process.exit(1);
}

/**
 * CPU em percentual.
 *
 * `os.cpus()` devolve contadores acumulados desde o boot, não uma taxa. A taxa
 * sai da diferença entre duas leituras — por isso guardamos a anterior em vez
 * de dormir dentro da medição.
 */
let leituraAnterior = null;

function amostraDeCpu() {
  const nucleos = os.cpus();
  let ocioso = 0;
  let total = 0;
  for (const nucleo of nucleos) {
    for (const [modo, valor] of Object.entries(nucleo.times)) {
      total += valor;
      if (modo === "idle") ocioso += valor;
    }
  }
  return { ocioso, total };
}

function cpuPercent() {
  const agora = amostraDeCpu();
  const anterior = leituraAnterior;
  leituraAnterior = agora;
  if (!anterior) return null;

  const deltaTotal = agora.total - anterior.total;
  const deltaOcioso = agora.ocioso - anterior.ocioso;
  if (deltaTotal <= 0) return null;
  return Math.min(100, Math.max(0, ((deltaTotal - deltaOcioso) / deltaTotal) * 100));
}

async function disco() {
  try {
    const info = await statfs(PASTA);
    const totalGb = (info.blocks * info.bsize) / 1024 ** 3;
    const livreGb = (info.bavail * info.bsize) / 1024 ** 3;
    return {
      diskTotalGb: Number(totalGb.toFixed(2)),
      diskUsedGb: Number((totalGb - livreGb).toFixed(2)),
    };
  } catch {
    // Volume de rede e alguns sistemas de arquivos não respondem statfs. Sem
    // medição, nenhum campo é enviado.
    return {};
  }
}

/**
 * Conexões abertas na porta de mídia.
 *
 * Aproximação deliberada e declarada: conta sockets ESTABLISHED na porta que
 * serve vídeo. Não é o mesmo que "pessoas assistindo" — o painel já mede isso
 * por telemetria de progresso. Aqui a pergunta é sobre carga da máquina.
 */
async function streamsAtivos() {
  const porta = process.env.AGENTE_PORTA_MIDIA;
  if (!porta) return 0;
  try {
    const { stdout } =
      process.platform === "win32"
        ? await executar("netstat", ["-an"])
        : await executar("sh", ["-c", "netstat -an 2>/dev/null || ss -tan"]);
    return stdout
      .split("\n")
      .filter((linha) => linha.includes(`:${porta}`) && /ESTABLISHED/i.test(linha))
      .length;
  } catch {
    return 0;
  }
}

async function montarBatimento() {
  const totalMb = Math.round(os.totalmem() / 1024 ** 2);
  const livreMb = Math.round(os.freemem() / 1024 ** 2);
  const carga = os.loadavg()[0];

  return {
    slug: SLUG,
    agentVersion: VERSAO,
    uptimeSec: Math.round(os.uptime()),
    cpuPercent: cpuPercent() ?? undefined,
    ramTotalMb: totalMb,
    ramUsedMb: totalMb - livreMb,
    // No Windows `loadavg` devolve zeros; zero aqui seria uma medição falsa.
    loadAvg: carga > 0 ? Number(carga.toFixed(2)) : undefined,
    activeStreams: await streamsAtivos(),
    ...(await disco()),
    payload: {
      host: os.hostname(),
      plataforma: `${os.platform()} ${os.release()}`,
      nucleos: os.cpus().length,
      pasta: PASTA,
    },
  };
}

async function bater() {
  const corpo = await montarBatimento();
  const resposta = await fetch(`${DESTINO}/api/agente/batimento`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agente-segredo": SEGREDO,
    },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new Error(`${resposta.status} ${texto.slice(0, 200)}`);
  }
  return corpo;
}

async function main() {
  console.log(
    `\n  agente ${VERSAO} · ${SLUG} → ${DESTINO}` +
      `\n  medindo disco em ${PASTA}` +
      (UMA_VEZ ? "\n" : `\n  batendo a cada ${INTERVALO_MS / 1000}s (ctrl+c para parar)\n`),
  );

  // A primeira leitura de CPU não tem anterior para comparar; uma amostra
  // descartada agora evita enviar um batimento sem CPU logo de cara.
  cpuPercent();
  await new Promise((resolver) => setTimeout(resolver, 500));

  const uma = async () => {
    try {
      const corpo = await bater();
      console.log(
        `  ${new Date().toLocaleTimeString("pt-BR")}  ` +
          `cpu ${corpo.cpuPercent === undefined ? "—" : `${Math.round(corpo.cpuPercent)}%`}  ` +
          `ram ${Math.round((corpo.ramUsedMb / corpo.ramTotalMb) * 100)}%  ` +
          (corpo.diskTotalGb
            ? `disco ${Math.round((corpo.diskUsedGb / corpo.diskTotalGb) * 100)}%  `
            : "") +
          `streams ${corpo.activeStreams}`,
      );
    } catch (erro) {
      // Falhar um batimento não derruba o agente: a rede cai, a aplicação
      // reinicia, e o certo é continuar tentando. O silêncio já aparece no
      // painel como servidor fora do ar.
      console.error(`  ${new Date().toLocaleTimeString("pt-BR")}  falhou: ${erro.message}`);
    }
  };

  await uma();
  if (UMA_VEZ) return;

  const timer = setInterval(uma, INTERVALO_MS);
  const parar = () => {
    clearInterval(timer);
    console.log("\n  agente encerrado\n");
    process.exit(0);
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
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
