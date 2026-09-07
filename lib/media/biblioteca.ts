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
};

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
 */
const INCOMPLETO = /\.(part|parcial|crdownload|tmp|!ut)$|\.part\./i;

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

type Manifesto = {
  dramaID?: string;
  dramaName?: string;
  totalEpisodes?: number;
  episodes?: Record<
    string,
    {
      file?: string;
      duration?: number;
      width?: number;
      height?: number;
      codec?: string;
    }
  >;
};

async function lerManifesto(pasta: string): Promise<Manifesto | null> {
  try {
    const bruto = await readFile(join(pasta, "manifest.json"), "utf8");
    return JSON.parse(bruto) as Manifesto;
  } catch {
    // Manifesto é conveniência, não requisito: sem ele o ffmpeg mede.
    return null;
  }
}

export async function lerBiblioteca(raiz: string): Promise<NovelaNoDisco[]> {
  const entradas = await readdir(raiz, { withFileTypes: true });
  const novelas: NovelaNoDisco[] = [];

  for (const entrada of entradas) {
    if (!entrada.isDirectory() || entrada.name.startsWith(".")) continue;

    const pasta = join(raiz, entrada.name);
    const [arquivos, manifesto] = await Promise.all([
      readdir(pasta, { withFileTypes: true }),
      lerManifesto(pasta),
    ]);

    // O manifesto indexa por número; o disco, por nome. Casar pelo nome do
    // arquivo é mais seguro que confiar na ordem das chaves.
    const porArquivo = new Map<
      string,
      NonNullable<Manifesto["episodes"]>[string]
    >();
    for (const dados of Object.values(manifesto?.episodes ?? {})) {
      if (dados?.file) porArquivo.set(dados.file, dados);
    }

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
      const doManifesto = porArquivo.get(arquivo.name);

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
    });
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
