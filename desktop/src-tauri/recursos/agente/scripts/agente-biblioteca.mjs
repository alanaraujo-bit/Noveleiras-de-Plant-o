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

const VERSAO = "1.0.2";
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

/** Segundos em algo que se lê de relance: "40s", "12min", "1h20". */
function duracao(seg) {
  if (seg < 90) return `${seg}s`;
  const min = Math.round(seg / 60);
  if (min < 90) return `${min}min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
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
      if (/^4\d\d /.test(erro.message)) throw erro;
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
  let mudo = 0;
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
      // Voltar a falar depois de um silêncio é notícia: até ali o painel
      // mostrava um número velho sem que ninguém soubesse.
      if (mudo > 0) {
        console.log(`  painel de volta (${mudo} relato(s) perdidos)`);
        mudo = 0;
      }
      return resposta.continuar !== false;
    } catch (erro) {
      // Rede instável não deve abortar uma varredura em andamento; o servidor
      // já trata varredura muda como abandonada. Mas o silêncio precisa
      // aparecer no registro: sem isto o agente segue trabalhando enquanto a
      // tela congela, e a varredura acaba morrendo com uma explicação que não
      // é a verdadeira.
      mudo += 1;
      if (mudo === 1 || mudo % 30 === 0) {
        console.log(`  painel não respondeu (${mudo}x): ${erro.message}`);
      }
      return true;
    }
  };
}

async function executar(varredura) {
  const { id: scanId, completa, biblioteca } = varredura;
  const reportar = criarReporter(scanId);
  // Marcado antes de tocar no disco: é daqui que saem tanto a estimativa do
  // que falta quanto o "pronto em" do fim.
  const comecou = Date.now();

  console.log("");
  console.log(
    `  varredura ${completa ? "completa" : "incremental"} · ${biblioteca.nome}`,
  );
  console.log(`  ${biblioteca.caminho}`);

  await reportar("abrindo a pasta", 0, 0, true);

  // A leitura da pasta era o trecho mudo da varredura: entre pegar o trabalho
  // e começar os metadados ninguém sabia se havia progresso. Agora cada pasta
  // lida vira um relato — e é ele que também mantém a varredura viva, porque
  // silêncio longo o servidor conta como agente morto.
  let ultimaPasta = 0;
  const novelas = await lerBiblioteca(biblioteca.caminho, (lidas, total, titulo) => {
    void reportar(`lendo pasta ${lidas}/${total} · ${titulo}`, 0, 0);
    // No registro, uma linha a cada 25 pastas: o bastante para ver a coisa
    // andar, longe de uma linha por pasta que ninguém consegue ler.
    if (lidas === total || lidas - ultimaPasta >= 25) {
      ultimaPasta = lidas;
      console.log(`  pastas lidas: ${lidas}/${total}`);
    }
  });

  const totalArquivos = novelas.reduce((s, n) => s + n.episodios.length, 0);
  const vazias = novelas.filter((n) => n.episodios.length === 0).length;
  console.log(
    `  ${novelas.length} novela(s) · ${totalArquivos} arquivo(s)` +
      (vazias > 0 ? ` · ${vazias} pasta(s) sem episódio` : ""),
  );

  const etapaMetadados = completa
    ? "lendo metadados e conferindo checksum"
    : "lendo metadados";
  if (!(await reportar(etapaMetadados, totalArquivos, 0, true))) {
    console.log("  cancelada pelo painel");
    return;
  }
  if (completa) {
    console.log("  completa: cada arquivo é sondado e somado de novo — demora");
  }

  let processados = 0;
  let ultimoRelato = 0;
  const comecouMetadados = Date.now();
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
      // A etapa nomeia a novela porque "4200 de 8899" não diz onde a
      // varredura está — e é o nome que deixa perceber que ela travou num
      // arquivo específico.
      if (
        !(await reportar(
          `${etapaMetadados} · ${novela.titulo}`,
          totalArquivos,
          processados,
        ))
      ) {
        console.log("  cancelada pelo painel");
        return;
      }
      if (processados - ultimoRelato >= 500 || processados === totalArquivos) {
        ultimoRelato = processados;
        // Conta da fase de metadados, não da varredura: incluir a leitura da
        // pasta faz a estimativa despencar de "17s" para "0s" enquanto o
        // tempo morto se dilui, e uma estimativa que muda assim não é uma
        // estimativa — é um número que se desmente sozinho.
        const decorrido = (Date.now() - comecouMetadados) / 1000;
        const porSeg = processados / Math.max(0.001, decorrido);
        const faltam = Math.round((totalArquivos - processados) / Math.max(0.1, porSeg));
        // A estimativa só entra quando diz algo. Numa varredura incremental os
        // metadados vêm do manifesto e a fase inteira dura segundos: repetir
        // "faltam ~0s" dezessete vezes é ruído com cara de informação.
        const vaiDemorar = processados < totalArquivos && faltam >= 5;
        console.log(
          `  metadados: ${processados}/${totalArquivos}` +
            (vaiDemorar ? ` · faltam ~${duracao(faltam)}` : ""),
        );
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
  console.log(
    `  enviando ao servidor: ${lotes.length} lote(s), ${totalArquivos} arquivo(s)`,
  );

  let resposta;
  let enviados = 0;
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

    enviados += lote.reduce((s, n) => s + n.episodios.length, 0);
    console.log(
      `  lote ${i + 1}/${lotes.length} · ${lote.length} novela(s) · ` +
        `${enviados}/${totalArquivos} arquivo(s) no servidor` +
        (ultimo ? " · importando e conferindo o que sumiu" : ""),
    );
  }
  const r = resposta.resultado;

  console.log(`  pronto em ${duracao(Math.round((Date.now() - comecou) / 1000))}`);
  console.log(
    `    ${r.novelasCriadas} novela(s) nova(s), ${r.novelasAtualizadas} atualizada(s)`,
  );
  console.log(
    `    ${r.episodiosCriados} episódio(s) novo(s), ${r.episodiosAtualizados} atualizado(s)`,
  );
  console.log(`    ${r.arquivosIndexados} arquivo(s) indexado(s)`);
  if (r.arquivosAusentes > 0) {
    console.log(
      `    ${r.arquivosAusentes} sumiram do disco` +
        (r.episodiosRemovidos > 0
          ? `, ${r.episodiosRemovidos} episódio(s) retirado(s) do catálogo`
          : " (catálogo preservado)"),
    );
  }
  for (const aviso of r.avisos.slice(0, 5)) console.log(`    ! ${aviso}`);
  if (r.avisos.length > 5) {
    console.log(`    e mais ${r.avisos.length - 5} aviso(s), no histórico do painel`);
  }
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
