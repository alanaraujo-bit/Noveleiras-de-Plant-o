/**
 * Varredor de bibliotecas.
 *
 * Roda na máquina que guarda os vídeos e é o braço do painel dentro do disco:
 * pega uma varredura da fila, lê a pasta, mede cada arquivo e devolve a árvore
 * encontrada. Quem grava no catálogo é o servidor — este processo nunca vê o
 * banco, e é de propósito: a credencial do banco não precisa existir na
 * máquina de casa.
 *
 * O checksum é a parte cara. Numa varredura incremental ele só roda em arquivo
 * novo ou de tamanho diferente; `--completa`, pedida no painel, recalcula
 * tudo — é o que detecta um arquivo corrompido que manteve o tamanho.
 *
 *   node --env-file=.env.agente scripts/agente-biblioteca.mjs
 *   node --env-file=.env.agente scripts/agente-biblioteca.mjs --uma-vez
 */
import ffmpegPath from "./ffmpeg.mjs";
import { ehOPrograma } from "./lib-agente.mjs";

import { lerBiblioteca } from "../lib/media/biblioteca.ts";
import { calcularChecksum, sondar } from "../lib/media/inventario.ts";

const VERSAO = "1.0.0";
const SLUG = process.env.AGENTE_SLUG;
const SEGREDO = process.env.AGENTE_SEGREDO;
const DESTINO = (process.env.AGENTE_DESTINO ?? "http://localhost:3100").replace(/\/$/, "");
const OCIOSO_MS = Math.max(5, Number(process.env.AGENTE_OCIOSO ?? 15)) * 1000;
const UMA_VEZ = process.argv.includes("--uma-vez");

/**
 * Tamanho de um lote de entrega.
 *
 * A árvore inteira num POST só bate no teto de corpo da função no servidor:
 * 8899 arquivos passam de 4 MB de JSON e a varredura morria em 413 sem tocar
 * no banco. Um lote fecha ao cruzar qualquer um dos dois limites, e a unidade
 * é a novela inteira — meia novela no catálogo é um estado que ninguém sabe
 * interpretar.
 *
 * Os episódios contam junto com os bytes porque o custo do outro lado é o
 * banco, não a rede: cada episódio são três idas ao Postgres, e o servidor
 * tem 300s para responder.
 */
const EPISODIOS_POR_LOTE = 250;
const BYTES_POR_LOTE = 1_000_000;
const TENTATIVAS_POR_LOTE = 3;

if (!SLUG || !SEGREDO) {
  console.error(
    "\n  AGENTE_SLUG e AGENTE_SEGREDO são obrigatórios." +
      '\n  Registre o servidor: npm run servidor -- registrar <slug> "<nome>"\n',
  );
  process.exit(1);
}

async function falar(corpo) {
  const resposta = await fetch(`${DESTINO}/api/agente/varredura`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agente-segredo": SEGREDO,
    },
    body: JSON.stringify({ slug: SLUG, ...corpo }),
  });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new Error(`${resposta.status} ${texto.slice(0, 300)}`);
  }
  return resposta.json();
}

/**
 * Envia de novo quando a rede falha.
 *
 * Uma varredura destas lê o disco por vinte minutos e depois faz trinta
 * requisições; uma piscada de rede na vigésima jogaria fora o trabalho todo.
 * Repetir é seguro porque a importação é idempotente do outro lado: a novela é
 * o slug do título e o episódio é o número na temporada, então um lote que
 * chegou duas vezes atualiza e não duplica.
 */
async function falarComTeimosia(corpo) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_LOTE; tentativa += 1) {
    try {
      return await falar(corpo);
    } catch (erro) {
      ultimoErro = erro;
      // 4xx é o servidor dizendo que o pedido está errado; repetir só demora
      // mais para chegar à mesma resposta.
      if (/^4dd /.test(erro.message)) throw erro;
      if (tentativa === TENTATIVAS_POR_LOTE) break;
      console.log(`  reenviando (${tentativa}/${TENTATIVAS_POR_LOTE}): ${erro.message}`);
      await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }
  throw ultimoErro;
}

/**
 * Divide a árvore em lotes que cabem num envio.
 *
 * Uma novela nunca é partida ao meio: ela entra inteira no lote corrente ou
 * abre o próximo.
 */
function dividirEmLotes(arvore) {
  const lotes = [];
  let atual = [];
  let episodios = 0;
  let bytes = 0;

  for (const novela of arvore) {
    const peso = JSON.stringify(novela).length;
    const cheio =
      atual.length > 0 &&
      (episodios + novela.episodios.length > EPISODIOS_POR_LOTE ||
        bytes + peso > BYTES_POR_LOTE);
    if (cheio) {
      lotes.push(atual);
      atual = [];
      episodios = 0;
      bytes = 0;
    }
    atual.push(novela);
    episodios += novela.episodios.length;
    bytes += peso;
  }

  if (atual.length > 0) lotes.push(atual);
  // Pasta vazia continua sendo uma entrega: é assim que o servidor descobre
  // que o disco não tem nada e decide se foi a pasta que esvaziou ou o disco
  // que saiu do ar. Sem lote nenhum, a varredura nunca fecharia.
  if (lotes.length === 0) lotes.push([]);
  return lotes;
}

/**
 * Reporta progresso sem afogar o servidor.
 *
 * Uma escrita por segundo: o painel não fica mais útil com dez por segundo, e
 * cada uma é uma linha tocada no banco. A resposta também é o canal pelo qual
 * um cancelamento no painel alcança este processo.
 */
function criarReporter(scanId) {
  let ultimo = 0;
  return async (etapa, total, processados, forcar = false) => {
    const agora = Date.now();
    if (!forcar && agora - ultimo < 1000) return true;
    ultimo = agora;
    try {
      const resposta = await falar({
        acao: "progresso",
        scanId,
        etapa,
        total,
        processados,
      });
      return resposta.continuar !== false;
    } catch {
      // Rede instável não deve abortar uma varredura em andamento; o
      // servidor já trata varredura muda como abandonada.
      return true;
    }
  };
}

async function executar(varredura) {
  const { id: scanId, completa, biblioteca } = varredura;
  const reportar = criarReporter(scanId);

  console.log(
    `\n  ${biblioteca.nome}` +
      `\n  ${biblioteca.caminho}` +
      (completa ? "  (completa)" : ""),
  );

  await reportar("varrendo a pasta", 0, 0, true);
  const novelas = await lerBiblioteca(biblioteca.caminho);

  const totalArquivos = novelas.reduce((s, n) => s + n.episodios.length, 0);
  console.log(`  ${novelas.length} novelas · ${totalArquivos} arquivos`);
  if (!(await reportar("lendo metadados", totalArquivos, 0, true))) {
    console.log("  cancelada pelo painel");
    return;
  }

  let processados = 0;
  const arvore = [];

  for (const novela of novelas) {
    const episodios = [];

    for (const episodio of novela.episodios) {
      // O manifesto poupa a sondagem quando trouxe o que precisamos.
      const temTudo =
        episodio.duracaoSeg !== null &&
        episodio.largura !== null &&
        episodio.altura !== null;

      const sondagem =
        temTudo && !completa
          ? {
              duracaoSeg: episodio.duracaoSeg,
              largura: episodio.largura,
              altura: episodio.altura,
              codecVideo: episodio.codec,
              codecAudio: null,
              bitrateKbps: null,
              fps: null,
              container: null,
              erro: null,
            }
          : await sondar(episodio.caminho, ffmpegPath);

      // Checksum só na varredura completa: em 246 arquivos de 10 MB ele custa
      // minutos, e o tamanho já denuncia a maior parte das mudanças.
      const checksum = completa
        ? await calcularChecksum(episodio.caminho).catch(() => null)
        : null;

      episodios.push({
        numero: episodio.numero,
        arquivo: episodio.arquivo,
        chave: episodio.chave,
        caminho: episodio.caminho,
        tamanhoBytes: episodio.tamanhoBytes,
        duracaoSeg: sondagem.duracaoSeg,
        largura: sondagem.largura,
        altura: sondagem.altura,
        codecVideo: sondagem.codecVideo,
        codecAudio: sondagem.codecAudio,
        bitrateKbps: sondagem.bitrateKbps,
        fps: sondagem.fps,
        container: sondagem.container,
        checksum,
        erro: sondagem.erro,
        // Do manifesto, sem sondagem: o disco já os provou ao ser lido.
        thumbChave: episodio.thumbChave,
        estreadoEm: episodio.estreadoEm,
        previa: episodio.previa,
      });

      processados += 1;
      if (!(await reportar("lendo metadados", totalArquivos, processados))) {
        console.log("  cancelada pelo painel");
        return;
      }
    }

    arvore.push({
      titulo: novela.titulo,
      pasta: novela.pasta,
      episodios,
      lacunas: novela.lacunas,
      ignorados: novela.ignorados,
      totalDeclarado: novela.totalDeclarado,
      origem: novela.origem,
      // Ficha e arte que o baixador deixou na pasta. O agente não as
      // interpreta: só as transporta até quem grava no catálogo.
      sinopse: novela.sinopse,
      capaChave: novela.capaChave,
      temas: novela.temas,
      fonte: novela.fonte,
      totalDuracaoSeg: novela.totalDuracaoSeg,
    });
  }

  const lotes = dividirEmLotes(arvore);
  console.log(`  enviando em ${lotes.length} lote(s)`);

  let resposta;
  for (const [i, lote] of lotes.entries()) {
    const ultimo = i === lotes.length - 1;
    const seguir = await reportar(
      `enviando ao servidor (${i + 1}/${lotes.length})`,
      totalArquivos,
      processados,
      true,
    );
    // Cancelar no painel alcança a entrega, não só a leitura do disco: o que
    // já entrou fica, e a varredura para onde está.
    if (!seguir) {
      console.log("  cancelada pelo painel");
      return;
    }
    resposta = await falarComTeimosia({
      acao: "entregar",
      scanId,
      lote: i + 1,
      totalLotes: lotes.length,
      ultimo,
      novelas: lote,
    });
  }
  const r = resposta.resultado;

  console.log(
    `  pronto: ${r.novelasCriadas} novela(s) nova(s), ${r.novelasAtualizadas} atualizada(s)` +
      `\n          ${r.episodiosCriados} episódio(s) novo(s), ${r.arquivosIndexados} arquivo(s) indexado(s)` +
      (r.arquivosAusentes > 0 ? `\n          ${r.arquivosAusentes} sumiram do disco` : ""),
  );
  for (const aviso of r.avisos.slice(0, 5)) console.log(`          ! ${aviso}`);
}

async function umCiclo() {
  const { varredura } = await falar({ acao: "pegar" });
  if (!varredura) return false;

  try {
    await executar(varredura);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`  falhou: ${mensagem}`);
    // O painel precisa saber por que parou; silêncio viraria "abandonada".
    await falar({ acao: "falhar", scanId: varredura.id, erro: mensagem }).catch(
      () => {},
    );
  }
  return true;
}

async function main() {
  if (!ffmpegPath) {
    console.error("\n  ffmpeg-static não resolveu um binário.\n");
    process.exit(1);
  }

  console.log(
    `\n  varredor ${VERSAO} · ${SLUG} → ${DESTINO}` +
      (UMA_VEZ ? "\n" : `\n  procurando varredura a cada ${OCIOSO_MS / 1000}s (ctrl+c para parar)\n`),
  );

  let rodando = true;
  const parar = () => {
    rodando = false;
    console.log("\n  varredor encerrado\n");
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
