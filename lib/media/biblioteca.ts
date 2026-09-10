import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Leitura de uma biblioteca de novelas no disco.
 *
 * A convenção é a que a biblioteca já usa, não uma inventada por nós:
 *
 *     Biblioteca/
 *       A Filha Secreta do CEO/
 *         A Filha Secreta do CEO - E01.mp4
 *         A Filha Secreta do CEO - E02.mp4
 *         manifest.json          (opcional)
 *
 * Uma pasta é uma novela; cada arquivo é um episódio, numerado pelo `E##` do
 * nome. Não há nível de temporada porque a biblioteca não tem — criar um
 * "Temporada 1" implícito é honesto (o schema exige), inventar temporadas que
 * não existem no disco não seria.
 *
 * Nada aqui escreve no banco: este módulo só lê e descreve. Quem grava é o
 * script de importação, e essa separação é o que permite ver o que vai
 * acontecer antes de acontecer.
 */

export type EpisodioNoDisco = {
  numero: number;
  arquivo: string;
  /** Caminho relativo à raiz da biblioteca — é a `mediaKey`. */
  chave: string;
  caminho: string;
  tamanhoBytes: number;
  /** Do manifesto, quando existe. */
  duracaoSeg: number | null;
  largura: number | null;
  altura: number | null;
  codec: string | null;
  /**
   * Miniatura própria do episódio, relativa à raiz — é a `thumbKey`.
   *
   * `null` quando não há arquivo: o catálogo cai na arte gerada. Só é
   * preenchida depois de confirmar que a imagem existe no disco, porque um
   * manifesto pode prometer o que o download não trouxe.
   */
  thumbChave: string | null;
  /** Estreia na origem, ISO. `null` = desconhecida; ninguém a inventa. */
  estreadoEm: string | null;
  /** Prévia ou introdução gratuita na plataforma de origem. */
  previa: boolean;
};

/**
 * Aviso de andamento durante a leitura da pasta.
 *
 * Existe porque esta função é o trecho mudo da varredura: entre "peguei o
 * trabalho" e "estou lendo metadados" ela percorre a biblioteca inteira sem
 * dizer nada, e quem clicou em Escanear fica olhando uma barra parada. Pior:
 * o servidor conta o silêncio como agente morto e recicla a varredura no
 * meio.
 *
 * O módulo continua sem saber o que é um painel — ele avisa, e quem chamou
 * decide o que fazer com o aviso.
 */
export type AvisoDeLeitura = (
  lidas: number,
  total: number,
  titulo: string,
) => void;

/** Um tema declarado pela origem. Cru, em inglês, como veio. */
export type TemaDaOrigem = { chave: string; valor: string };

export type NovelaNoDisco = {
  titulo: string;
  pasta: string;
  episodios: EpisodioNoDisco[];
  /** Números faltando na sequência: E01, E02, E04 acusa o 3. */
  lacunas: number[];
  /** Arquivos que não casaram com o padrão de nome. */
  ignorados: string[];
  /** O manifesto declarou mais episódios do que há no disco. */
  totalDeclarado: number | null;
  origem: string | null;
  /**
   * Sinopse da origem. `null` quando não há — e continua `null`, porque
   * inventar resumo engana quem lê o catálogo.
   */
  sinopse: string | null;
  /** Capa real, relativa à raiz. `null` = arte gerada. */
  capaChave: string | null;
  /**
   * Trailer real, relativo à raiz. `null` quando a novela não tem um.
   *
   * Segue a mesma regra da capa: manifesto promete, disco prova. Um trailer
   * declarado cujo arquivo não veio vira `null`, e não um botão que dá 404.
   */
  trailerChave: string | null;
  /**
   * Temas da origem, sem tradução.
   *
   * Viram gênero por decisão de quem edita, no painel — nunca sozinhos: o
   * vocabulário da plataforma é em inglês e não é o do produto.
   */
  temas: TemaDaOrigem[];
  /** "tiktok", "reelshort"… `null` quando o manifesto não diz. */
  fonte: string | null;
  /** Duração total declarada pela origem, em segundos. */
  totalDuracaoSeg: number | null;
};

/**
 * O que conta como episódio no disco.
 *
 * `.ts` entra porque é o que sai de muita gravação e de fluxo HLS baixado —
 * um MPEG-TS é vídeo legítimo. Ele exige um passo a mais que os outros: o
 * navegador não toca TS puro, então precisa virar MP4 antes de ir ao ar. Quem
 * decide isso é `precisaDeConversao`, não esta lista; aqui a pergunta é só
 * "isto é um vídeo?".
 */
const VIDEO = /\.(mp4|m4v|mov|mkv|webm|ts|mts|m2ts)$/i;

/**
 * Formatos que o navegador não reproduz direto.
 *
 * Um MPEG-TS tem o mesmo h264 dentro de um MP4, mas num contêiner que o
 * `<video>` recusa. A conversão é remux — troca o invólucro, não recodifica —
 * e por isso é rápida e sem perda de qualidade.
 */
const PRECISA_CONVERTER = /\.(ts|mts|m2ts|mkv)$/i;

/**
 * Arquivo que ainda está sendo baixado ou convertido.
 *
 * Um `.part` no meio da biblioteca é um download em curso, não um episódio.
 * Catalogá-lo criaria um episódio quebrado que se conserta sozinho depois —
 * e um alerta falso é pior que nenhum alerta.
 *
 * O sufixo intermediário vem antes da extensão final, e é aí que mora a
 * armadilha: `Novela - E01.parcial.mp4` termina em `.mp4` e carrega um número
 * de episódio válido. Sem a alternativa do meio, ele entrava no catálogo como
 * se fosse o episódio pronto.
 */
const INCOMPLETO =
  /\.(part|parcial|crdownload|tmp|!ut)$|\.(part|parcial|tmp|crdownload)\./i;

export function precisaDeConversao(arquivo: string): boolean {
  return PRECISA_CONVERTER.test(arquivo);
}

/**
 * O número do episódio.
 *
 * Aceita as formas que aparecem na prática — `- E01`, `E01`, `S01E01`, `ep 1`
 * — porque uma biblioteca real é irregular e recusar o arquivo por causa do
 * nome só empurraria o trabalho para a pessoa.
 */
export function numeroDoEpisodio(nome: string): number | null {
  const semExtensao = nome.replace(VIDEO, "");
  const padroes = [
    /S\d{1,2}\s*E\s*(\d{1,4})/i,
    /(?:^|[\s\-_.])E\s*(\d{1,4})(?:$|[\s\-_.])/i,
    /(?:^|[\s\-_.])(?:ep|epis[oó]dio|cap[ií]tulo)\s*(\d{1,4})/i,
    // Último recurso: um número solto no fim do nome.
    /(\d{1,4})\s*$/,
  ];
  for (const padrao of padroes) {
    const achado = semExtensao.match(padrao);
    if (achado) {
      const numero = Number(achado[1]);
      if (Number.isFinite(numero) && numero > 0) return numero;
    }
  }
  return null;
}

/**
 * O `manifest.json` que o baixador escreve na pasta da novela.
 *
 * O contrato vive em `CONTRATO-NOVELEIRAS.md`, no repositório da ferramenta
 * de download. Tudo aqui é opcional de propósito: o manifesto é conveniência,
 * nunca requisito, e uma biblioteca sem nenhum continua importando.
 *
 * As URLs de capa da origem são assinadas e expiram, então o manifesto aponta
 * para **arquivos** baixados ao lado dos vídeos — nunca para endereços.
 */
type Manifesto = {
  dramaID?: string;
  dramaName?: string;
  totalEpisodes?: number;
  source?: string;
  description?: string;
  /** Caminho relativo à pasta da novela. */
  poster?: string;
  /**
   * Vídeo de apresentação, relativo à pasta (`trailer.mp4`).
   *
   * Opcional de verdade: a maioria das novelas não tem um, e o catálogo
   * precisa continuar funcionando sem ele.
   */
  trailer?: string;
  totalDurationSec?: number;
  themes?: { key?: string; value?: string }[];
  episodes?: Record<
    string,
    {
      file?: string;
      duration?: number;
      width?: number;
      height?: number;
      codec?: string;
      /** Caminho relativo à pasta da novela. */
      thumb?: string;
      createdAt?: string;
      isPreview?: boolean;
      isFreeIntro?: boolean;
    }
  >;
};

/**
 * Nome sem extensão, em minúsculas.
 *
 * O casamento entre manifesto e disco é feito por aqui, e não pelo nome
 * completo, porque a extensão muda depois de gravada: um `.ts` do HLS vira
 * `.mp4` na conversão, e o manifesto foi escrito antes disso. Comparar o nome
 * inteiro perderia os metadados de toda série convertida.
 */
function semExtensao(nome: string): string {
  return nome.replace(/\.[^.]+$/, "").toLowerCase();
}

const IMAGEM = /\.(jpe?g|png|webp|avif)$/i;

/**
 * As imagens que a pasta realmente tem, em minúsculas.
 *
 * Existe para que uma capa só seja publicada depois de provada: o manifesto
 * pode apontar para um arquivo que o download não trouxe, e uma `posterKey`
 * apontando para o vazio quebraria a capa em vez de cair na arte gerada.
 *
 * Cobre a raiz da pasta e `thumbs/`, que é onde a convenção põe as
 * miniaturas. Uma varredura recursiva completa custaria caro para achar o que
 * sabidamente mora em dois lugares.
 */
async function lerArtes(pasta: string): Promise<Set<string>> {
  const achadas = new Set<string>();

  const listar = async (dir: string, prefixo: string) => {
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of entradas) {
      if (item.isFile() && IMAGEM.test(item.name)) {
        achadas.add(`${prefixo}${item.name}`.toLowerCase());
      }
    }
  };

  await Promise.all([
    listar(pasta, ""),
    listar(join(pasta, "thumbs"), "thumbs/"),
  ]);
  return achadas;
}

async function lerManifesto(pasta: string): Promise<Manifesto | null> {
  try {
    const bruto = await readFile(join(pasta, "manifest.json"), "utf8");
    return JSON.parse(bruto) as Manifesto;
  } catch {
    // Manifesto é conveniência, não requisito: sem ele o ffmpeg mede.
    return null;
  }
}

export async function lerBiblioteca(
  raiz: string,
  aoAndar?: AvisoDeLeitura,
): Promise<NovelaNoDisco[]> {
  const entradas = await readdir(raiz, { withFileTypes: true });
  const pastas = entradas.filter(
    (e) => e.isDirectory() && !e.name.startsWith("."),
  );
  const novelas: NovelaNoDisco[] = [];

  for (const entrada of pastas) {

    const pasta = join(raiz, entrada.name);
    const [arquivos, manifesto, imagens] = await Promise.all([
      readdir(pasta, { withFileTypes: true }),
      lerManifesto(pasta),
      lerArtes(pasta),
    ]);

    type DadosDoManifesto = NonNullable<Manifesto["episodes"]>[string];

    // O manifesto indexa por número; o disco, por nome. Guardamos os dois
    // caminhos: o nome (sem extensão) é o mais específico e vem primeiro; o
    // número é o que sobrevive a um arquivo renomeado à mão.
    const porArquivo = new Map<string, DadosDoManifesto>();
    const porNumero = new Map<number, DadosDoManifesto>();
    for (const [chave, dados] of Object.entries(manifesto?.episodes ?? {})) {
      if (!dados) continue;
      if (dados.file) porArquivo.set(semExtensao(dados.file), dados);
      const numero = Number(chave);
      if (Number.isInteger(numero) && numero > 0) porNumero.set(numero, dados);
    }

    /** Só vira chave o que existe no disco: manifesto promete, disco prova. */
    const arteNoDisco = (declarado: string | undefined, padrao: string) => {
      for (const candidato of [declarado, padrao]) {
        if (!candidato) continue;
        const limpo = candidato.replace(/^\.?[\\/]+/, "").replace(/\\/g, "/");
        if (imagens.has(limpo.toLowerCase())) {
          return `${entrada.name}/${limpo}`;
        }
      }
      return null;
    };

    /**
     * O trailer, provado no disco.
     *
     * Não usa `arteNoDisco` porque aquilo consulta o índice de imagens; aqui o
     * arquivo é vídeo. Um intermediário de download não conta: `INCOMPLETO`
     * barra o `trailer.parcial.mp4` que uma conversão interrompida deixou.
     */
    const trailerNoDisco = (): string | null => {
      const candidatos = [manifesto?.trailer, "trailer.mp4"];
      for (const candidato of candidatos) {
        if (!candidato) continue;
        const limpo = candidato.replace(/^\.?[\\/]+/, "").replace(/\\/g, "/");
        if (limpo.includes("/") || !VIDEO.test(limpo) || INCOMPLETO.test(limpo)) {
          continue;
        }
        const existe = arquivos.some(
          (a) => a.isFile() && a.name.toLowerCase() === limpo.toLowerCase(),
        );
        if (existe) return `${entrada.name}/${limpo}`;
      }
      return null;
    };

    const episodios: EpisodioNoDisco[] = [];
    const ignorados: string[] = [];

    for (const arquivo of arquivos) {
      if (!arquivo.isFile() || !VIDEO.test(arquivo.name)) continue;
      // Download em curso não é episódio: ele vira um, sozinho, quando
      // terminar.
      if (INCOMPLETO.test(arquivo.name)) continue;

      const numero = numeroDoEpisodio(arquivo.name);
      if (numero === null) {
        ignorados.push(arquivo.name);
        continue;
      }

      const caminho = join(pasta, arquivo.name);
      const info = await stat(caminho);
      const doManifesto =
        porArquivo.get(semExtensao(arquivo.name)) ?? porNumero.get(numero);

      const numeroPadrao = String(numero).padStart(2, "0");

      episodios.push({
        numero,
        arquivo: arquivo.name,
        chave: `${entrada.name}/${arquivo.name}`,
        caminho,
        tamanhoBytes: info.size,
        duracaoSeg: doManifesto?.duration ?? null,
        largura: doManifesto?.width ?? null,
        altura: doManifesto?.height ?? null,
        codec: doManifesto?.codec ?? null,
        thumbChave: arteNoDisco(
          doManifesto?.thumb,
          `thumbs/E${numeroPadrao}.jpg`,
        ),
        estreadoEm: doManifesto?.createdAt ?? null,
        previa: Boolean(doManifesto?.isPreview || doManifesto?.isFreeIntro),
      });
    }

    episodios.sort((a, b) => a.numero - b.numero);

    const presentes = new Set(episodios.map((e) => e.numero));
    const maximo = episodios.length ? Math.max(...presentes) : 0;
    const lacunas: number[] = [];
    for (let n = 1; n <= maximo; n += 1) {
      if (!presentes.has(n)) lacunas.push(n);
    }

    // Número repetido é ambiguidade, não duplicata: dois arquivos disputando o
    // mesmo episódio precisam de decisão humana.
    const vistos = new Map<number, string[]>();
    for (const episodio of episodios) {
      vistos.set(episodio.numero, [
        ...(vistos.get(episodio.numero) ?? []),
        episodio.arquivo,
      ]);
    }
    for (const [numero, nomes] of vistos) {
      if (nomes.length > 1) {
        ignorados.push(
          `episódio ${numero} aparece em ${nomes.length} arquivos: ${nomes.join(", ")}`,
        );
      }
    }

    novelas.push({
      titulo: manifesto?.dramaName?.trim() || entrada.name,
      pasta: entrada.name,
      episodios,
      lacunas,
      ignorados,
      totalDeclarado: manifesto?.totalEpisodes ?? null,
      origem: manifesto?.dramaID ?? null,
      sinopse: manifesto?.description?.trim() || null,
      capaChave: arteNoDisco(manifesto?.poster, "poster.jpg"),
      trailerChave: trailerNoDisco(),
      temas: (manifesto?.themes ?? [])
        .map((tema) => ({
          chave: tema?.key?.trim() ?? "",
          valor: tema?.value?.trim() ?? "",
        }))
        .filter((tema) => tema.valor !== ""),
      fonte: manifesto?.source?.trim() || null,
      totalDuracaoSeg: manifesto?.totalDurationSec ?? null,
    });

    aoAndar?.(novelas.length, pastas.length, novelas[novelas.length - 1].titulo);
  }

  return novelas.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/**
 * Resolve uma chave de URL para um caminho dentro da raiz.
 *
 * É a única barreira entre um endereço público e o resto do disco, e por isso
 * nega por padrão: devolve `null` para tudo que não termine comprovadamente
 * dentro da raiz.
 *
 * Vive aqui, e não dentro do servidor, para poder ser testada sem subir
 * processo nenhum. Uma fronteira de segurança que só é exercitada por curl é
 * uma fronteira que ninguém verifica de novo.
 */
export function caminhoDentroDaRaiz(
  raiz: string,
  chave: string,
  ferramentas: {
    resolve: (...partes: string[]) => string;
    join: (...partes: string[]) => string;
    normalize: (caminho: string) => string;
    sep: string;
  },
): string | null {
  let decodificada: string;
  try {
    decodificada = decodeURIComponent(chave);
  } catch {
    // Percentagem malformada é entrada hostil, não descuido.
    return null;
  }
  // Byte nulo trunca caminho em algumas camadas nativas.
  if (decodificada.includes("\0")) return null;

  const raizAbsoluta = ferramentas.resolve(raiz);
  const alvo = ferramentas.resolve(
    ferramentas.join(raizAbsoluta, ferramentas.normalize(decodificada)),
  );

  // `startsWith` sozinho aceitaria uma pasta irmã de nome parecido
  // ("/biblioteca" e "/biblioteca-antiga"); o separador fecha isso.
  if (alvo !== raizAbsoluta && !alvo.startsWith(raizAbsoluta + ferramentas.sep)) {
    return null;
  }
  return alvo;
}

/**
 * A estreia declarada pelo manifesto, quando ela é uma data de verdade.
 *
 * Devolve `null` para qualquer coisa que não seja uma data válida, e o
 * chamador cai na data de hoje. Uma data inventada por um `new Date` que
 * virou `Invalid Date` entraria no catálogo como buraco, e um episódio sem
 * estreia plausível desordena a lista inteira.
 */
export function dataDaEstreia(bruto: string | null): Date | null {
  if (!bruto) return null;
  const data = new Date(bruto);
  if (Number.isNaN(data.getTime())) return null;
  return data;
}

/** Slug estável a partir do título. Mesma entrada, mesmo slug, sempre. */
export function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Cor de destaque derivada do título.
 *
 * O catálogo desenha a própria arte e precisa de uma cor por novela. Derivar
 * do título mantém a escolha estável entre importações e dentro da paleta do
 * produto — vinho, carmim e rosa — em vez de sortear algo fora do mundo dele.
 */
export function corDoTitulo(titulo: string): string {
  const PALETA = [
    "#B3325A",
    "#8E2547",
    "#C4406B",
    "#7A2D52",
    "#A82E63",
    "#93304F",
    "#C13A55",
    "#6F2444",
  ];
  let soma = 0;
  for (const letra of titulo) soma = (soma * 31 + letra.charCodeAt(0)) % 100_000;
  return PALETA[soma % PALETA.length];
}

/** Texto que a busca compara: sem acento, minúsculo. */
export function textoDeBusca(...partes: (string | null | undefined)[]): string {
  return partes
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decide se vale retirar do catálogo o que sumiu do disco.
 *
 * A pergunta que isto responde é "a pasta esvaziou, ou o disco sumiu?". As
 * duas coisas chegam ao código iguais — nenhum arquivo encontrado —, e
 * tratá-las do mesmo jeito apagaria a biblioteca inteira de quem apenas
 * desconectou um HD externo. Por isso, quando a varredura não achou NADA e o
 * catálogo tinha conteúdo, não se remove nada: espera-se a próxima varredura,
 * com o disco de volta.
 *
 * O preço é conhecido: quem esvazia a pasta de propósito continua vendo o
 * catálogo antigo e resolve pelo botão Remover na tela de Mídia. Perder um
 * clique é melhor que perder o catálogo por um cabo solto.
 *
 * Mora aqui, e não em `lib/painel/bibliotecas.ts`, porque aquele módulo é
 * `server-only` e não carrega fora do Next — uma regra desta gravidade
 * precisa ser exercitada por teste.
 */
export function podeRemover(vistos: number, conhecidos: number): boolean {
  if (conhecidos === 0) return false;
  return vistos > 0;
}
