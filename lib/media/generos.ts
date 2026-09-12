import type { PrismaClient } from "@prisma/client";

// Extensão explícita: estes módulos são carregados direto pelo Node nos
// scripts de importação, e o Node só resolve o caminho completo.
import { GENEROS } from "./temas.ts";

/**
 * Gravação dos gêneros.
 *
 * Separado de `temas` de propósito: lá é a decisão editorial (o que cada tema
 * significa), aqui é o banco. Quem importa a biblioteca e quem reclassifica o
 * catálogo passam pelos dois lados sem duplicar nem a tabela nem a regra.
 */

/**
 * Garante que os gêneros do produto existam, com nome, frase e cor atuais.
 *
 * `upsert` e não `create`: o catálogo de demonstração e a biblioteca importada
 * compartilham a mesma lista, e rodar os dois na ordem que for não pode gerar
 * gênero duplicado nem desfazer uma renomeação.
 */
export async function garantirGeneros(
  db: PrismaClient,
): Promise<Map<string, string>> {
  const porSlug = new Map<string, string>();

  for (const [ordem, genero] of GENEROS.entries()) {
    const gravado = await db.genre.upsert({
      where: { slug: genero.slug },
      create: { ...genero, sort: ordem },
      update: { ...genero, sort: ordem },
      select: { id: true, slug: true },
    });
    porSlug.set(gravado.slug, gravado.id);
  }

  return porSlug;
}

/**
 * Liga uma novela aos seus gêneros.
 *
 * Apagar e regravar numa transação é o mesmo caminho que a edição pelo painel
 * usa (`lib/painel/acoes/catalogo`), e pelo mesmo motivo: evita o instante em
 * que a novela aparece sem gênero nenhum para quem estiver navegando.
 *
 * Lista vazia não apaga nada. Uma novela que a origem não soube classificar
 * deve continuar com o que alguém ligou à mão, e não perder isso na próxima
 * importação.
 */
export async function vincularGeneros(
  db: PrismaClient,
  novelaId: string,
  slugs: string[],
  generoPorSlug: Map<string, string>,
): Promise<number> {
  const ids = slugs
    .map((slug) => generoPorSlug.get(slug))
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return 0;

  await db.$transaction([
    db.novelaGenre.deleteMany({ where: { novelaId } }),
    db.novelaGenre.createMany({
      data: ids.map((genreId) => ({ novelaId, genreId })),
      skipDuplicates: true,
    }),
  ]);

  return ids.length;
}
