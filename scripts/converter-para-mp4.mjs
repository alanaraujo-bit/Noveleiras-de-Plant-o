/**
 * Converte vídeos que o navegador não toca para MP4.
 *
 * Um MPEG-TS (`.ts`) tem o mesmo h264/aac de um MP4 — o que muda é o
 * invólucro, e o `<video>` do navegador recusa esse invólucro. A conversão é
 * **remux**: troca o contêiner e copia os fluxos como estão. Não recodifica,
 * então é rápida, não perde qualidade e não esquenta a máquina.
 *
 * Por que existe como comando e não como etapa da varredura: converter mexe no
 * disco de quem manda, e isso não deve acontecer por efeito colateral de um
 * botão de "escanear". Aqui a pessoa pede.
 *
 * O original é preservado por padrão. `--apagar-origem` só depois de conferir
 * que o MP4 abre.
 *
 *   npm run midia:converter -- --raiz="D:/Noveleiras de Plantão"
 *   npm run midia:converter -- --raiz="D:/Noveleiras de Plantão" --aplicar
 */
import { execFile } from "node:child_process";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const executar = promisify(execFile);

function argumento(nome, padrao) {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
}

const RAIZ = argumento("raiz", process.env.BIBLIOTECA_RAIZ);
const APLICAR = process.argv.includes("--aplicar");
const APAGAR = process.argv.includes("--apagar-origem");

/** Contêineres que o navegador recusa mesmo com codec compatível. */
const CONVERTER = /\.(ts|mts|m2ts|mkv)$/i;

if (!RAIZ) {
  console.error(
    '\n  Diga onde fica a biblioteca:\n    npm run midia:converter -- --raiz="D:/Novelas"\n',
  );
  process.exit(1);
}

function bytes(valor) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = valor;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

async function varrer(raiz) {
  const achados = [];
  async function descer(dir) {
    for (const entrada of await readdir(dir, { withFileTypes: true })) {
      if (entrada.name.startsWith(".")) continue;
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        await descer(caminho);
        continue;
      }
      if (!CONVERTER.test(entrada.name)) continue;
      const info = await stat(caminho);
      achados.push({ caminho, nome: entrada.name, tamanho: info.size });
    }
  }
  await descer(raiz);
  return achados.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

async function existe(caminho) {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!ffmpegPath) {
    console.error("\n  ffmpeg-static não resolveu um binário.\n");
    process.exit(1);
  }

  console.log(`\n  Procurando em ${RAIZ}\n`);
  const arquivos = await varrer(RAIZ);

  if (arquivos.length === 0) {
    console.log("  Nenhum arquivo precisa de conversão.\n");
    return;
  }

  let convertidos = 0;
  let pulados = 0;
  let falhas = 0;
  let apagados = 0;
  let bytesOrigem = 0;

  for (const arquivo of arquivos) {
    const destino = arquivo.caminho.replace(CONVERTER, ".mp4");
    bytesOrigem += arquivo.tamanho;

    if (await existe(destino)) {
      pulados += 1;
      // Já convertido antes. Com `--apagar-origem`, esta é a segunda passada:
      // a pessoa conferiu que os MP4 abrem e agora quer o espaço de volta.
      // Sem este ramo, o original de uma conversão anterior nunca sairia.
      if (APLICAR && APAGAR) {
        await rm(arquivo.caminho, { force: true });
        apagados += 1;
      }
      continue;
    }
    if (!APLICAR) {
      console.log(`  → ${arquivo.nome}  ${bytes(arquivo.tamanho)}`);
      continue;
    }

    // Grava num temporário e só depois renomeia: uma conversão interrompida
    // deixaria um MP4 truncado que a varredura catalogaria como bom.
    // O temporário precisa terminar em .mp4: o ffmpeg escolhe o formato de
    // saída pela extensão, e ".parcial" não diz nada a ele. Um sufixo antes da
    // extensão preserva as duas coisas — o formato e a marca de incompleto.
    const temporario = destino.replace(/\.mp4$/, ".parcial.mp4");
    const comuns = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", arquivo.caminho,
      // Copia os fluxos: nada é recodificado.
      "-c", "copy",
      // Índice no começo do arquivo, para o player buscar sem baixar tudo.
      "-movflags", "+faststart",
    ];

    try {
      try {
        await executar(ffmpegPath, [
          ...comuns,
          // TS traz h264 em Annex-B; o MP4 espera AVCC.
          "-bsf:v", "h264_mp4toannexb,dump_extra",
          temporario,
        ]);
      } catch (erroComFiltro) {
        // Alguns arquivos já vêm em AVCC e o filtro recusa. A conversão
        // simples resolve — e se ela também falhar, o erro que interessa é o
        // dela, não o do filtro.
        await rm(temporario, { force: true });
        await executar(ffmpegPath, [...comuns, temporario]);
      }

      await rename(temporario, destino);
      const info = await stat(destino);
      console.log(
        `  ✓ ${arquivo.nome} → ${bytes(info.size)}` +
          (APAGAR ? " (origem apagada)" : ""),
      );
      if (APAGAR) await rm(arquivo.caminho, { force: true });
      convertidos += 1;
    } catch (erro) {
      await rm(temporario, { force: true });
      const mensagem = String(erro.stderr ?? erro.message ?? erro)
        .split("\n")
        .filter(Boolean)
        .slice(-2)
        .join(" ");
      console.error(`  ✗ ${arquivo.nome}: ${mensagem.slice(0, 160)}`);
      falhas += 1;
    }
  }

  console.log(
    `\n  ${arquivos.length} arquivo(s) · ${bytes(bytesOrigem)}` +
      (pulados > 0 ? `\n  ${pulados} já tinham MP4 ao lado` : "") +
      (apagados > 0 ? `\n  ${apagados} original(is) apagado(s)` : ""),
  );

  if (!APLICAR) {
    console.log("\n  Nada foi convertido. Repita com --aplicar.\n");
    return;
  }

  console.log(
    `  ${convertidos} convertido(s)` + (falhas > 0 ? ` · ${falhas} falha(s)` : ""),
  );
  console.log(
    APAGAR
      ? "\n  Escaneie a biblioteca no painel para atualizar o catálogo.\n"
      : "\n  Os originais foram mantidos. Confira que os MP4 abrem e rode de novo\n" +
          "  com --apagar-origem para liberar o espaço.\n",
  );
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
