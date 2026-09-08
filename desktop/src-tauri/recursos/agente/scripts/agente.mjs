/**
 * O agente da casa: um processo, quatro trabalhos.
 *
 * Antes eram quatro programas com quatro comandos decorados, e o preço disso
 * apareceu na prática: bastava esquecer um no ar para o painel ficar
 * "aguardando o agente" indefinidamente, sem que nada dissesse qual dos três
 * estava faltando. Nomes parecidos (`agente`, `agente:transcode`,
 * `agente:biblioteca`) tornavam o erro fácil e o diagnóstico difícil.
 *
 * Agora é um só. Liga tudo, e o que ele não consegue fazer, ele diz.
 *
 * Os quatro trabalhos continuam existindo como módulos próprios — dá para
 * rodar um isolado quando se quer depurar só ele — mas em operação normal
 * nascem e morrem juntos.
 *
 *   node --env-file=.env.agente scripts/agente.mjs
 *
 * O painel administrativo não liga isto sozinho: página web não inicia
 * processo na máquina de ninguém. Por isso existe o aplicativo de bandeja, que
 * é quem sobe este agente — este arquivo é o motor dele.
 */
import { resolve } from "node:path";

import { ehOPrograma } from "./lib-agente.mjs";

const VERSAO = "1.0.0";

/** O que cada trabalho precisa para existir. Faltando, ele não sobe — e diz. */
const TRABALHOS = [
  {
    id: "midia",
    nome: "servidor de mídia",
    exige: ["BIBLIOTECA_RAIZ"],
    async iniciar() {
      const { iniciar } = await import("./servir-midia.mjs");
      const raiz = resolve(process.env.BIBLIOTECA_RAIZ);
      const porta = Number(process.env.MIDIA_PORTA ?? 8099);
      await iniciar({ raiz, porta, silencioso: true });
      return `na porta ${porta}, servindo ${raiz}`;
    },
  },
  {
    id: "biblioteca",
    nome: "varredor da biblioteca",
    exige: ["AGENTE_SLUG", "AGENTE_SEGREDO"],
    async iniciar() {
      const { executar } = await import("./agente-biblioteca.mjs");
      // Laço infinito: não se espera por ele, senão os outros nunca subiriam.
      manter("varredor", executar);
      return "atento à fila de varreduras";
    },
  },
  {
    id: "transcode",
    nome: "transcodificador",
    exige: ["AGENTE_SLUG", "AGENTE_SEGREDO"],
    async iniciar() {
      const { executar } = await import("./agente-transcode.mjs");
      manter("transcodificador", executar);
      return "atento à fila de conversões";
    },
  },
  {
    id: "batimento",
    nome: "batimento",
    exige: ["AGENTE_SLUG", "AGENTE_SEGREDO"],
    async iniciar() {
      const { executar } = await import("./agente-midia.mjs");
      manter("batimento", executar);
      return "reportando ao painel";
    },
  },
];

/**
 * Mantém um laço vivo.
 *
 * Um trabalho que morre por um erro de rede não pode levar os outros três
 * junto: sem isto, uma queda momentânea do painel derrubaria o servidor de
 * mídia, e ninguém assistiria nada por causa de um `fetch` que falhou.
 */
function manter(nome, laco) {
  let tentativas = 0;
  const rodar = () => {
    laco().catch((erro) => {
      tentativas += 1;
      // Espera crescente com teto: insistir de segundo em segundo contra uma
      // causa que não se resolve só gasta CPU e enche o log.
      const espera = Math.min(30, 2 ** Math.min(tentativas, 5));
      console.error(`  [${nome}] caiu: ${erro.message} — de novo em ${espera}s`);
      setTimeout(rodar, espera * 1000);
    });
  };
  rodar();
}

function faltando(trabalho) {
  return trabalho.exige.filter((chave) => !process.env[chave]?.trim());
}

export async function iniciarAgente() {
  const subiram = [];
  const parados = [];

  for (const trabalho of TRABALHOS) {
    const falta = faltando(trabalho);
    if (falta.length) {
      // Não subir em silêncio é o ponto: era assim que a varredura ficava
      // esperando para sempre sem ninguém saber por quê.
      parados.push(`${trabalho.nome}: falta ${falta.join(", ")}`);
      continue;
    }
    try {
      subiram.push(`${trabalho.nome} — ${await trabalho.iniciar()}`);
    } catch (erro) {
      parados.push(`${trabalho.nome}: ${erro.message}`);
    }
  }
  return { subiram, parados };
}

if (ehOPrograma(import.meta.url)) {
  const { subiram, parados } = await iniciarAgente();

  console.log(`\n  agente ${VERSAO} · ${process.env.AGENTE_SLUG ?? "sem slug"}`);
  for (const linha of subiram) console.log(`   · ${linha}`);
  for (const linha of parados) console.error(`   ! ${linha}`);
  if (!subiram.length) {
    console.error("\n  nenhum trabalho subiu; nada a fazer\n");
    process.exit(1);
  }
  console.log("\n  ctrl+c para parar\n");

  for (const sinal of ["SIGINT", "SIGTERM"]) {
    process.on(sinal, () => {
      console.log("\n  agente encerrado\n");
      process.exit(0);
    });
  }
}
