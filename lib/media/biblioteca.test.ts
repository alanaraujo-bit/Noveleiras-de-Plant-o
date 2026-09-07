import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path, { dirname, join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  caminhoDentroDaRaiz,
  corDoTitulo,
  dataDaEstreia,
  lerBiblioteca,
  numeroDoEpisodio,
  precisaDeConversao,
  slugificar,
  textoDeBusca,
} from "./biblioteca";

/**
 * A raiz é testada nos dois formatos de caminho porque a biblioteca vive no
 * Windows e o app publica no Linux — uma guarda que só vale num deles não
 * serve.
 */
const win = {
  resolve: path.win32.resolve,
  join: path.win32.join,
  normalize: path.win32.normalize,
  sep: path.win32.sep,
};
const posix = {
  resolve: path.posix.resolve,
  join: path.posix.join,
  normalize: path.posix.normalize,
  sep: path.posix.sep,
};

describe("caminhoDentroDaRaiz", () => {
  const RAIZ_WIN = "D:\\Biblioteca";
  const RAIZ_POSIX = "/srv/biblioteca";

  it("aceita um arquivo dentro da raiz", () => {
    expect(caminhoDentroDaRaiz(RAIZ_WIN, "Novela/E01.mp4", win)).toBe(
      "D:\\Biblioteca\\Novela\\E01.mp4",
    );
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, "Novela/E01.mp4", posix)).toBe(
      "/srv/biblioteca/Novela/E01.mp4",
    );
  });

  it("aceita nome com espaço e acento, que é o caso real", () => {
    const chave = encodeURIComponent("A Filha Secreta do CEO") + "/E01.mp4";
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, chave, posix)).toBe(
      "/srv/biblioteca/A Filha Secreta do CEO/E01.mp4",
    );
  });

  it("recusa subir de diretório", () => {
    expect(caminhoDentroDaRaiz(RAIZ_WIN, "../Windows/win.ini", win)).toBeNull();
    expect(caminhoDentroDaRaiz(RAIZ_WIN, "../../../etc/passwd", win)).toBeNull();
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, "../../etc/passwd", posix)).toBeNull();
  });

  it("recusa subida escondida em codificação", () => {
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, "%2e%2e/%2e%2e/etc/passwd", posix)).toBeNull();
    expect(caminhoDentroDaRaiz(RAIZ_WIN, "..%5c..%5cWindows", win)).toBeNull();
  });

  it("recusa subida no meio do caminho", () => {
    expect(
      caminhoDentroDaRaiz(RAIZ_POSIX, "Novela/../../etc/passwd", posix),
    ).toBeNull();
  });

  it("recusa pasta irmã de nome parecido", () => {
    // O perigo de comparar com startsWith sem o separador.
    expect(caminhoDentroDaRaiz("/srv/bib", "../bib-secreta/x.mp4", posix)).toBeNull();
  });

  it("recusa byte nulo e percentagem malformada", () => {
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, "arquivo%00.mp4", posix)).toBeNull();
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, "%zz", posix)).toBeNull();
  });

  it("trata caminho absoluto como relativo à raiz, nunca como absoluto", () => {
    // `join` gruda a chave na raiz em vez de deixá-la escapar — o resultado
    // fica dentro da biblioteca e simplesmente não existe. É o comportamento
    // seguro, e o teste existe para que ninguém o "conserte" para resolve().
    expect(caminhoDentroDaRaiz(RAIZ_POSIX, "/etc/passwd", posix)).toBe(
      "/srv/biblioteca/etc/passwd",
    );
    expect(caminhoDentroDaRaiz(RAIZ_WIN, "C:/Windows/win.ini", win)).toBe(
      "D:\\Biblioteca\\C:\\Windows\\win.ini",
    );
  });
});

describe("numeroDoEpisodio", () => {
  it("lê o padrão da biblioteca real", () => {
    expect(numeroDoEpisodio("A Filha Secreta do CEO - E01.mp4")).toBe(1);
    expect(numeroDoEpisodio("Mãe por Um Milhão - E50.mp4")).toBe(50);
  });

  it("lê as outras formas que aparecem na prática", () => {
    expect(numeroDoEpisodio("S01E07.mp4")).toBe(7);
    expect(numeroDoEpisodio("Novela ep 12.mp4")).toBe(12);
    expect(numeroDoEpisodio("Capítulo 3.mkv")).toBe(3);
    expect(numeroDoEpisodio("novela-04.mp4")).toBe(4);
  });

  it("não confunde número do título com número do episódio", () => {
    // "7 Dias" tem um número no nome, mas o episódio é o E02.
    expect(numeroDoEpisodio("7 Dias de Fevereiro - E02.mp4")).toBe(2);
  });

  it("devolve null quando não há número", () => {
    expect(numeroDoEpisodio("trailer.mp4")).toBeNull();
    expect(numeroDoEpisodio("making-of.mp4")).toBeNull();
  });
});

describe("slugificar", () => {
  it("tira acento, pontuação e espaço", () => {
    expect(slugificar("Mãe por Um Milhão")).toBe("mae-por-um-milhao");
    expect(slugificar("Casamento Relâmpago: O Sr. Monteiro!")).toBe(
      "casamento-relampago-o-sr-monteiro",
    );
  });

  it("é estável — a mesma entrada dá o mesmo slug", () => {
    const titulo = "A Cura Mortal do Bilionário";
    expect(slugificar(titulo)).toBe(slugificar(titulo));
  });
});

describe("corDoTitulo", () => {
  it("é estável entre importações", () => {
    expect(corDoTitulo("Mãe por Um Milhão")).toBe(corDoTitulo("Mãe por Um Milhão"));
  });

  it("fica dentro da paleta do produto", () => {
    for (const titulo of ["A", "B", "Novela Longa de Teste", "Zé"]) {
      expect(corDoTitulo(titulo)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("textoDeBusca", () => {
  it("normaliza para o que a busca compara", () => {
    expect(textoDeBusca("Coração", "em Plantão")).toBe("coracao em plantao");
  });

  it("ignora partes ausentes", () => {
    expect(textoDeBusca("Título", null, undefined, "")).toBe("titulo");
  });
});

describe("arquivos que não são episódio", () => {
  it("reconhece contêiner que o navegador recusa", () => {
    expect(precisaDeConversao("Novela - E01.ts")).toBe(true);
    expect(precisaDeConversao("Novela - E01.mkv")).toBe(true);
    expect(precisaDeConversao("Novela - E01.mp4")).toBe(false);
    expect(precisaDeConversao("Novela - E01.webm")).toBe(false);
  });
});

/**
 * Daqui para baixo os testes tocam o disco de verdade, numa pasta temporária.
 *
 * O que está em jogo é o encontro entre o manifesto que o baixador escreve e
 * os arquivos que ele deixou — e esse encontro não se prova com objeto
 * simulado: o que quebra na prática é extensão trocada e arquivo prometido
 * que não chegou.
 */
describe("lerBiblioteca", () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "biblioteca-"));
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  async function montar(
    pasta: string,
    arquivos: Record<string, string>,
    manifesto?: unknown,
  ) {
    await mkdir(join(raiz, pasta), { recursive: true });
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      const destino = join(raiz, pasta, nome);
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, conteudo);
    }
    if (manifesto !== undefined) {
      await writeFile(
        join(raiz, pasta, "manifest.json"),
        JSON.stringify(manifesto),
      );
    }
  }

  it("traz ficha, capa e miniatura quando o manifesto e os arquivos existem", async () => {
    await montar(
      "A Cura Mortal",
      {
        "A Cura Mortal - E01.mp4": "v",
        "poster.jpg": "img",
        "thumbs/E01.jpg": "img",
      },
      {
        dramaID: "7677784436146164743",
        dramaName: "A Cura Mortal do Bilionário",
        totalEpisodes: 40,
        source: "tiktok",
        description: "Adeline luta para pagar as contas da mãe.",
        poster: "poster.jpg",
        themes: [{ key: "tag_Contractlovers", value: "Contract Lovers" }],
        episodes: {
          1: {
            file: "A Cura Mortal - E01.mp4",
            duration: 160,
            thumb: "thumbs/E01.jpg",
            createdAt: "2026-08-23T04:46:12Z",
            isPreview: true,
          },
        },
      },
    );

    const [novela] = await lerBiblioteca(raiz);

    // O título do manifesto ganha do nome da pasta.
    expect(novela.titulo).toBe("A Cura Mortal do Bilionário");
    expect(novela.sinopse).toBe("Adeline luta para pagar as contas da mãe.");
    expect(novela.fonte).toBe("tiktok");
    expect(novela.temas).toEqual([
      { chave: "tag_Contractlovers", valor: "Contract Lovers" },
    ]);
    // A chave é relativa à raiz — a mesma linguagem dos vídeos.
    expect(novela.capaChave).toBe("A Cura Mortal/poster.jpg");
    expect(novela.episodios[0].thumbChave).toBe("A Cura Mortal/thumbs/E01.jpg");
    expect(novela.episodios[0].duracaoSeg).toBe(160);
    expect(novela.episodios[0].previa).toBe(true);
    expect(novela.episodios[0].estreadoEm).toBe("2026-08-23T04:46:12Z");
  });

  it("casa o manifesto com o arquivo já convertido de .ts para .mp4", async () => {
    // O manifesto foi escrito quando o arquivo era MPEG-TS; a conversão
    // trocou a extensão. Comparar o nome inteiro perderia a duração.
    await montar(
      "Votos Despedaçados",
      { "Votos Despedaçados - E01.mp4": "v" },
      {
        dramaName: "Votos Despedaçados",
        episodes: {
          1: { file: "Votos Despedaçados - E01.ts", duration: 95 },
        },
      },
    );

    const [novela] = await lerBiblioteca(raiz);
    expect(novela.episodios[0].duracaoSeg).toBe(95);
  });

  it("cai no número quando o arquivo foi renomeado à mão", async () => {
    await montar(
      "Presídio Estrela",
      { "E01.mp4": "v" },
      {
        dramaName: "Presídio Estrela",
        episodes: { 1: { file: "outro-nome-qualquer.mp4", duration: 77 } },
      },
    );

    const [novela] = await lerBiblioteca(raiz);
    expect(novela.episodios[0].duracaoSeg).toBe(77);
  });

  it("não publica capa que o manifesto promete mas o disco não tem", async () => {
    await montar(
      "Sem Arte",
      { "Sem Arte - E01.mp4": "v" },
      { dramaName: "Sem Arte", poster: "poster.jpg", episodes: {} },
    );

    const [novela] = await lerBiblioteca(raiz);
    // `null` manda o catálogo para a arte gerada, que é melhor que uma
    // imagem quebrada.
    expect(novela.capaChave).toBeNull();
    expect(novela.episodios[0].thumbChave).toBeNull();
  });

  it("acha capa e miniatura pela convenção, sem manifesto declarar", async () => {
    await montar("Só Arquivos", {
      "Só Arquivos - E01.mp4": "v",
      "poster.jpg": "img",
      "thumbs/E01.jpg": "img",
    });

    const [novela] = await lerBiblioteca(raiz);
    expect(novela.capaChave).toBe("Só Arquivos/poster.jpg");
    expect(novela.episodios[0].thumbChave).toBe("Só Arquivos/thumbs/E01.jpg");
  });

  it("uma pasta sem manifesto nem arte continua importável", async () => {
    // É a biblioteca de hoje: só vídeo. Nada pode quebrar por isso.
    await montar("Antiga", { "Antiga - E01.mp4": "v", "Antiga - E02.mp4": "v" });

    const [novela] = await lerBiblioteca(raiz);
    expect(novela.titulo).toBe("Antiga");
    expect(novela.episodios).toHaveLength(2);
    expect(novela.capaChave).toBeNull();
    expect(novela.sinopse).toBeNull();
    expect(novela.temas).toEqual([]);
    expect(novela.episodios[0].previa).toBe(false);
  });

  it("uma imagem solta não vira episódio", async () => {
    await montar("Com Capa", { "Com Capa - E01.mp4": "v", "poster.jpg": "img" });

    const [novela] = await lerBiblioteca(raiz);
    expect(novela.episodios).toHaveLength(1);
    expect(novela.ignorados).toEqual([]);
  });
});

describe("dataDaEstreia", () => {
  it("aceita a data ISO do manifesto", () => {
    expect(dataDaEstreia("2026-08-23T04:46:12Z")?.toISOString()).toBe(
      "2026-08-23T04:46:12.000Z",
    );
  });

  it("recusa o que não é data, em vez de gravar uma inválida", () => {
    expect(dataDaEstreia(null)).toBeNull();
    expect(dataDaEstreia("")).toBeNull();
    expect(dataDaEstreia("ontem")).toBeNull();
  });
});
