import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  caminhoDentroDaRaiz,
  corDoTitulo,
  numeroDoEpisodio,
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
