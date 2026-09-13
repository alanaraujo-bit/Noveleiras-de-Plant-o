import type { PrismaClient } from "@prisma/client";

import { slugify } from "../text.ts";

/**
 * Gravação do elenco.
 *
 * A origem entrega nomes soltos dentro dos temas; aqui eles viram gente com
 * endereço próprio. O nome é a identidade — duas linhas com o mesmo nome são a
 * mesma pessoa, e é por isso que o slug sai dele.
 *
 * A origem não distingue homônimos. Corrigir o nome no painel não divide
 * pessoas nem funde grafias diferentes; isso exige revisão dos vínculos.
 */

/** Nome vazio ou que vira slug vazio não é pessoa: entrada torta, ignorada. */
function pessoaValida(nome: string): boolean {
  return nome.trim().length > 0 && slugify(nome).length > 0;
}

/**
 * Garante as pessoas e liga a novela a elas, na ordem recebida.
 *
 * A transação reconcilia vínculos sem apagar os que continuam existindo: isso
 * preserva o personagem que a curadoria já informou. As pessoas em si nunca
 * são apagadas — uma delas pode estar em outra novela, e a biografia escrita
 * à mão mora nelas.
 */
export async function vincularElenco(
  db: PrismaClient,
  novelaId: string,
  nomes: string[],
): Promise<number> {
  const limpos = [...new Map(nomes.map((n) => n.trim()).filter(pessoaValida)
    .map((nome) => [slugify(nome), nome])).values()];
  if (limpos.length === 0) return 0;

  const pessoas = [];
  for (const nome of limpos) {
    pessoas.push(
      await db.person.upsert({
        where: { slug: slugify(nome) },
        // O nome não é atualizado numa reimportação: quem corrigiu a grafia no
        // painel fez uma escolha, e a origem não é autoridade sobre ela.
        create: { slug: slugify(nome), name: nome },
        update: {},
        select: { id: true },
      }),
    );
  }

  await db.$transaction([
    db.novelaCast.deleteMany({ where: { novelaId, personId: { notIn: pessoas.map((p) => p.id) } } }),
    ...pessoas.map((pessoa, sort) => db.novelaCast.upsert({
      where: { novelaId_personId: { novelaId, personId: pessoa.id } },
      create: { novelaId, personId: pessoa.id, sort },
      update: { sort }, // Preserva o personagem já informado no catálogo.
    })),
  ]);

  return pessoas.length;
}
