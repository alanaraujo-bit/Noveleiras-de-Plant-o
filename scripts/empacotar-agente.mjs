/**
 * Copia o agente para dentro do instalador de bandeja.
 *
 * O app de bandeja não roda os arquivos do repositório: ele roda a cópia que o
 * Tauri empacota de `desktop/src-tauri/recursos/agente`. As duas pastas já se
 * separaram uma vez em silêncio — a cópia empacotada ficou com uma versão
 * antiga de `lib/media/biblioteca.ts` — e o sintoma disso é o pior possível:
 * o conserto passa nos testes, entra no commit, e a máquina de casa continua
 * rodando o código velho.
 *
 * Por isso existem os dois modos:
 *
 *   node scripts/empacotar-agente.mjs            copia e relata o que mudou
 *   node scripts/empacotar-agente.mjs --conferir só acusa, sem escrever
 *
 * O modo `--conferir` é o que o teste usa, para a deriva falhar no `npm test`
 * em vez de falhar no PC de casa.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { ehOPrograma } from "./lib-agente.mjs";

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const DESTINO = join(RAIZ, "desktop", "src-tauri", "recursos", "agente");

/**
 * O que viaja dentro do instalador.
 *
 * A lista é explícita, e não uma varredura de pasta, porque nem todo script do
 * repositório deve ir junto: `provar-*.mjs` fala com o banco, e o agente não
 * tem — nem deve ter — a credencial dele.
 */
export const ARQUIVOS_DO_AGENTE = [
  "scripts/agente.mjs",
  "scripts/agente-biblioteca.mjs",
  "scripts/agente-midia.mjs",
  "scripts/agente-transcode.mjs",
  "scripts/ffmpeg.mjs",
  "scripts/lib-agente.mjs",
  "scripts/servir-midia.mjs",
  "lib/media/assinatura.ts",
  "lib/media/biblioteca.ts",
  "lib/media/inventario.ts",
];

/**
 * Os imports relativos de tudo que foi empacotado apontam para dentro do
 * pacote.
 *
 * A lista acima é escrita à mão, e uma lista à mão fica para trás: foi assim
 * que `servir-midia.mjs` passou a exigir link assinado importando
 * `lib/media/assinatura.ts`, que ninguém lembrou de empacotar. No repositório
 * tudo funciona; no instalador o agente morre no primeiro import.
 *
 * Conferir os imports é o que fecha isso — a lista deixa de precisar de
 * memória e passa a precisar apenas de estar completa, o que a máquina sabe
 * verificar.
 */
export function conferirImportes() {
  const empacotados = new Set(ARQUIVOS_DO_AGENTE);
  const faltando = [];

  for (const relativo of ARQUIVOS_DO_AGENTE) {
    const fonte = readFileSync(join(RAIZ, relativo), "utf8");
    const pasta = dirname(relativo);
    for (const casamento of fonte.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const alvo = join(pasta, casamento[1]).split(sep).join("/");
      if (!empacotados.has(alvo)) faltando.push(`${relativo} → ${alvo}`);
    }
  }
  return faltando;
}

/** Os que estão diferentes da origem. Vazio significa empacotado em dia. */
export function conferirAgente() {
  const diferentes = [];
  for (const relativo of ARQUIVOS_DO_AGENTE) {
    const origem = readFileSync(join(RAIZ, relativo), "utf8");
    let copia = null;
    try {
      copia = readFileSync(join(DESTINO, relativo), "utf8");
    } catch {
      // Ausente conta como diferente: é o caso de um arquivo novo.
    }
    if (copia !== origem) diferentes.push(relativo);
  }
  return diferentes;
}

function empacotar() {
  const diferentes = conferirAgente();
  for (const relativo of diferentes) {
    writeFileSync(
      join(DESTINO, relativo),
      readFileSync(join(RAIZ, relativo), "utf8"),
    );
  }
  return diferentes;
}

if (ehOPrograma(import.meta.url)) {
  const soConferir = process.argv.includes("--conferir");

  // Antes de copiar: copiar um arquivo que importa o que não vai junto é
  // trocar um instalador velho por um instalador quebrado.
  const orfaos = conferirImportes();
  if (orfaos.length > 0) {
    console.error(
      `\n  ${orfaos.length} import(es) apontam para fora do instalador:\n` +
        orfaos.map((f) => `    ${f}`).join("\n") +
        "\n\n  acrescente o arquivo a ARQUIVOS_DO_AGENTE\n",
    );
    process.exit(1);
  }

  const diferentes = soConferir ? conferirAgente() : empacotar();

  if (diferentes.length === 0) {
    console.log("\n  agente empacotado está em dia\n");
  } else if (soConferir) {
    console.error(
      `\n  ${diferentes.length} arquivo(s) fora de sincronia com o instalador:\n` +
        diferentes.map((f) => `    ${f}`).join("\n") +
        "\n\n  rode: npm run agente:empacotar\n",
    );
    process.exit(1);
  } else {
    console.log(
      `\n  ${diferentes.length} arquivo(s) copiados para o instalador:\n` +
        diferentes.map((f) => `    ${f}`).join("\n") +
        "\n\n  o app de bandeja precisa ser reconstruído para levá-los\n",
    );
  }
}
