"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { registrarAuditoria, diferenca } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";
import { normalizeText } from "@/lib/text";

/**
 * Edição do elenco.
 *
 * A origem do catálogo entrega o nome de quem atua e nada mais — nem o
 * personagem, nem a foto, nem uma linha sobre a pessoa. A página de quem atua
 * mostra o que é fato (as novelas em que ela está) e deixa o resto vazio até
 * alguém escrever. Este é esse lugar.
 *
 * Duas edições, e as duas são sobre gente real: a grafia do nome, que a
 * origem às vezes erra ("Marc Hermann" e "Marc Herrmann" chegaram como duas
 * pessoas), e a biografia. Ambas ficam na auditoria com o estado anterior —
 * texto sobre uma pessoa é o tipo de coisa que precisa ser reconstruível.
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

function tratarErro(erro: unknown, contexto: string): ResultadoDaAcao {
  if (erro instanceof z.ZodError) {
    return { ok: false, erro: "Confira os campos: nome de 1 a 120 caracteres e biografia de até 2.000 caracteres." };
  }
  if (erro instanceof SemPermissao) {
    return { ok: false, erro: "Você não tem permissão para esta ação." };
  }
  void log.error({ channel: "ADMIN", message: `Falha em ${contexto}`, erro });
  return { ok: false, erro: "Não deu para concluir. Tente de novo." };
}

const pessoaSchema = z.object({
  personId: z.string().min(1),
  nome: z.string().trim().min(1).max(120).optional(),
  biografia: z.string().trim().max(2000).optional(),
});

export async function editarPessoa(
  entrada: z.infer<typeof pessoaSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("catalogo.editar");
    const dados = pessoaSchema.parse(entrada);

    const antes = await db.person.findUnique({
      where: { id: dados.personId },
      select: { id: true, slug: true, name: true, bio: true },
    });
    if (!antes) return { ok: false, erro: "Pessoa não encontrada." };

    const nome = dados.nome ?? antes.name;
    const biografia = dados.biografia ?? antes.bio;

    const novelas = await db.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: dados.personId },
        // Slug estável: links compartilhados sobrevivem à correção do nome.
        data: { ...(dados.nome !== undefined ? { name: nome } : {}),
          ...(dados.biografia !== undefined ? { bio: biografia } : {}) },
      });
      const vinculadas = await tx.novela.findMany({
        where: { castLinks: { some: { personId: dados.personId } } },
        select: { id: true, slug: true, title: true, synopsis: true, tags: true,
          castLinks: { select: { person: { select: { name: true } } } } },
      });
      if (nome !== antes.name) {
        for (const novela of vinculadas) await tx.novela.update({
          where: { id: novela.id },
          data: { searchText: normalizeText([novela.title, novela.synopsis,
            ...novela.tags, ...novela.castLinks.map((v) => v.person.name)].join(" ")) },
        });
      }
      return vinculadas;
    }, { timeout: 15000 });

    const mudanca = diferenca(
      { nome: antes.name, biografia: antes.bio },
      { nome, biografia },
    );

    if (mudanca) {
      await registrarAuditoria(operador, {
        action: "catalogo.pessoa.editar",
        targetType: "Person",
        targetId: antes.id,
        targetLabel: nome,
        before: mudanca.before,
        after: mudanca.after,
        severity: "INFO",
      });
    }

    revalidatePath(`/elenco/${antes.slug}`);
    revalidatePath("/painel/catalogo");
    revalidatePath("/painel/elenco");
    revalidatePath(`/painel/elenco/${antes.id}`);
    revalidatePath("/explorar");
    for (const novela of novelas) revalidatePath(`/novela/${novela.slug}`);

    return {
      ok: true,
      mensagem: mudanca ? "Elenco atualizado." : "Nada mudou.",
    };
  } catch (erro) {
    return tratarErro(erro, "editarPessoa");
  }
}
