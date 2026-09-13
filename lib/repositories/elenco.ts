import "server-only";

import { db } from "@/lib/db";
import { posterUrl } from "@/lib/media/resolver";
import { fotoDoElenco } from "@/lib/media/fotos-elenco";

/**
 * Fronteira de dados do elenco.
 *
 * O que a página de uma pessoa mostra sai todo de fato registrado: os nomes
 * vieram do manifesto da origem, as novelas vieram dos vínculos, e a
 * biografia — quando existe — foi escrita por alguém no painel. Nada aqui é
 * gerado a partir de suposição.
 */

export type PessoaDoElenco = {
  slug: string;
  name: string;
  /** Quantas novelas do catálogo têm esta pessoa. */
  novelaCount: number;
};

export type NovelaDaPessoa = {
  id: string;
  slug: string;
  title: string;
  posterUrl: string;
  episodeCount: number;
  /** O gênero mais específico da obra, na ordem editorial. */
  genero: string | null;
};

export type PerfilDaPessoa = {
  slug: string;
  name: string;
  /** Vazia até alguém escrever no painel. A página não mostra vazio. */
  bio: string;
  /** `null` enquanto não houver foto. A página cai nas iniciais. */
  fotoUrl: string | null;
  novelas: NovelaDaPessoa[];
};

/** O elenco de uma novela, na ordem em que a origem listou. */
export async function elencoDaNovela(
  novelaId: string,
): Promise<PessoaDoElenco[]> {
  const linhas = await db.novelaCast.findMany({
    where: { novelaId },
    orderBy: { sort: "asc" },
    select: {
      person: {
        select: {
          slug: true,
          name: true,
          _count: { select: { novelas: true } },
        },
      },
    },
  });

  return linhas.map((linha) => ({
    slug: linha.person.slug,
    name: linha.person.name,
    novelaCount: linha.person._count.novelas,
  }));
}

export async function getPessoa(slug: string): Promise<PerfilDaPessoa | null> {
  const pessoa = await db.person.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      bio: true,
      photoKey: true,
      novelas: {
        orderBy: { novela: { viewCount: "desc" } },
        select: {
          novela: {
            select: {
              id: true,
              slug: true,
              title: true,
              posterKey: true,
              _count: { select: { episodes: true } },
              genres: {
                orderBy: { genre: { sort: "asc" } },
                take: 1,
                select: { genre: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!pessoa) return null;

  return {
    slug: pessoa.slug,
    name: pessoa.name,
    bio: pessoa.bio,
    fotoUrl: fotoDoElenco(pessoa.slug, pessoa.photoKey),
    novelas: pessoa.novelas.map(({ novela }) => ({
      id: novela.id,
      slug: novela.slug,
      title: novela.title,
      posterUrl: posterUrl(novela.posterKey),
      episodeCount: novela._count.episodes,
      genero: novela.genres[0]?.genre.name ?? null,
    })),
  };
}
