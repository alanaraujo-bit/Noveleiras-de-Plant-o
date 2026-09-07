"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { textoDeBusca } from "@/lib/media/biblioteca";
import { registrarAuditoria, diferenca } from "@/lib/painel/auditoria";
import { exigirPermissaoNaAcao, SemPermissao } from "@/lib/painel/guarda";
import { log } from "@/lib/painel/log";

/**
 * Edição do catálogo.
 *
 * A importação cria a estrutura e se recusa a inventar texto: sinopse,
 * tagline e gênero nascem vazios porque adivinhá-los enganaria quem lê. Esta
 * é a outra metade — o lugar onde quem sabe escreve.
 *
 * `searchText` é reescrito a cada edição. Ele é o que a busca compara, e um
 * título editado sem reindexar vira uma novela que existe e não é encontrada.
 */

export type ResultadoDaAcao =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

function tratarErro(erro: unknown, contexto: string): ResultadoDaAcao {
  if (erro instanceof SemPermissao) {
    return { ok: false, erro: "Você não tem permissão para esta ação." };
  }
  void log.error({ channel: "ADMIN", message: `Falha em ${contexto}`, erro });
  return { ok: false, erro: "Não deu para concluir. Tente de novo." };
}

const novelaSchema = z.object({
  novelaId: z.string().min(1),
  titulo: z.string().trim().min(1).max(200).optional(),
  tagline: z.string().trim().max(200).optional(),
  sinopse: z.string().trim().max(4000).optional(),
  ano: z.number().int().min(1900).max(2200).optional(),
  classificacao: z.string().trim().max(5).optional(),
  status: z.enum(["ONGOING", "COMPLETED", "COMING_SOON"]).optional(),
  acesso: z.enum(["FREE", "PREMIUM"]).optional(),
  destaque: z.boolean().optional(),
  generos: z.array(z.string().min(1)).max(8).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export async function editarNovela(
  entrada: z.infer<typeof novelaSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("catalogo.editar");
    const dados = novelaSchema.parse(entrada);

    const antes = await db.novela.findUnique({
      where: { id: dados.novelaId },
      select: {
        id: true,
        title: true,
        tagline: true,
        synopsis: true,
        year: true,
        ageRating: true,
        status: true,
        accessTier: true,
        isFeatured: true,
        tags: true,
        genres: { select: { genreId: true } },
      },
    });
    if (!antes) return { ok: false, erro: "Novela não encontrada." };

    const titulo = dados.titulo ?? antes.title;
    const sinopse = dados.sinopse ?? antes.synopsis;
    const tags = dados.tags ?? antes.tags;

    await db.novela.update({
      where: { id: dados.novelaId },
      data: {
        title: titulo,
        tagline: dados.tagline ?? antes.tagline,
        synopsis: sinopse,
        year: dados.ano ?? antes.year,
        ageRating: dados.classificacao ?? antes.ageRating,
        status: dados.status ?? antes.status,
        accessTier: dados.acesso ?? antes.accessTier,
        isFeatured: dados.destaque ?? antes.isFeatured,
        tags,
        // Reindexar aqui é o que impede uma novela editada de sumir da busca.
        searchText: textoDeBusca(titulo, sinopse, tags.join(" ")),
      },
    });

    // Gênero é relação; trocar a lista é apagar e regravar. Fazer isso numa
    // transação evita o instante em que a novela não tem gênero nenhum.
    if (dados.generos) {
      await db.$transaction([
        db.novelaGenre.deleteMany({ where: { novelaId: dados.novelaId } }),
        db.novelaGenre.createMany({
          data: dados.generos.map((genreId) => ({
            novelaId: dados.novelaId,
            genreId,
          })),
          skipDuplicates: true,
        }),
      ]);
    }

    const mudanca = diferenca(
      {
        titulo: antes.title,
        tagline: antes.tagline,
        sinopse: antes.synopsis,
        status: antes.status,
        acesso: antes.accessTier,
        destaque: antes.isFeatured,
        generos: antes.genres.map((g) => g.genreId).sort(),
      },
      {
        titulo,
        tagline: dados.tagline ?? antes.tagline,
        sinopse,
        status: dados.status ?? antes.status,
        acesso: dados.acesso ?? antes.accessTier,
        destaque: dados.destaque ?? antes.isFeatured,
        ...(dados.generos ? { generos: [...dados.generos].sort() } : {}),
      },
    );

    if (mudanca) {
      await registrarAuditoria(operador, {
        action: "catalogo.novela.editar",
        targetType: "Novela",
        targetId: antes.id,
        targetLabel: titulo,
        before: mudanca.before,
        after: mudanca.after,
        severity: "INFO",
      });
    }

    revalidatePath("/painel/catalogo");
    revalidatePath(`/painel/catalogo/${dados.novelaId}`);

    return {
      ok: true,
      mensagem: mudanca ? "Novela atualizada." : "Nada mudou.",
    };
  } catch (erro) {
    return tratarErro(erro, "editarNovela");
  }
}

const episodioSchema = z.object({
  episodioId: z.string().min(1),
  titulo: z.string().trim().min(1).max(200).optional(),
  sinopse: z.string().trim().max(2000).optional(),
  acesso: z.enum(["FREE", "PREMIUM"]).optional(),
  bonus: z.boolean().optional(),
});

export async function editarEpisodio(
  entrada: z.infer<typeof episodioSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("catalogo.editar");
    const dados = episodioSchema.parse(entrada);

    const antes = await db.episode.findUnique({
      where: { id: dados.episodioId },
      select: {
        id: true,
        number: true,
        title: true,
        synopsis: true,
        accessTier: true,
        isBonus: true,
        novelaId: true,
        novela: { select: { title: true } },
      },
    });
    if (!antes) return { ok: false, erro: "Episódio não encontrado." };

    await db.episode.update({
      where: { id: dados.episodioId },
      data: {
        title: dados.titulo ?? antes.title,
        synopsis: dados.sinopse ?? antes.synopsis,
        accessTier: dados.acesso ?? antes.accessTier,
        isBonus: dados.bonus ?? antes.isBonus,
      },
    });

    const mudanca = diferenca(
      {
        titulo: antes.title,
        sinopse: antes.synopsis,
        acesso: antes.accessTier,
        bonus: antes.isBonus,
      },
      {
        titulo: dados.titulo ?? antes.title,
        sinopse: dados.sinopse ?? antes.synopsis,
        acesso: dados.acesso ?? antes.accessTier,
        bonus: dados.bonus ?? antes.isBonus,
      },
    );

    if (mudanca) {
      await registrarAuditoria(operador, {
        action: "catalogo.episodio.editar",
        targetType: "Episode",
        targetId: antes.id,
        targetLabel: `${antes.novela.title} · Ep. ${antes.number}`,
        before: mudanca.before,
        after: mudanca.after,
        severity: "INFO",
      });
    }

    revalidatePath(`/painel/catalogo/${antes.novelaId}`);
    return { ok: true, mensagem: mudanca ? "Episódio atualizado." : "Nada mudou." };
  } catch (erro) {
    return tratarErro(erro, "editarEpisodio");
  }
}

/**
 * Aplica acesso a uma novela inteira.
 *
 * Existe porque a alternativa é abrir 76 episódios um a um. O painel de
 * Catálogo mostra quantos são afetados antes de confirmar.
 */
const acessoEmLoteSchema = z.object({
  novelaId: z.string().min(1),
  acesso: z.enum(["FREE", "PREMIUM"]),
  /** Quantos episódios do começo ficam abertos mesmo numa novela paga. */
  gratuitosAteEpisodio: z.number().int().min(0).max(999).optional(),
});

export async function aplicarAcessoEmLote(
  entrada: z.infer<typeof acessoEmLoteSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("catalogo.publicar");
    const dados = acessoEmLoteSchema.parse(entrada);

    const novela = await db.novela.findUnique({
      where: { id: dados.novelaId },
      select: { id: true, title: true, _count: { select: { episodes: true } } },
    });
    if (!novela) return { ok: false, erro: "Novela não encontrada." };

    const abertos = dados.gratuitosAteEpisodio ?? 0;

    await db.$transaction([
      db.novela.update({
        where: { id: dados.novelaId },
        data: { accessTier: dados.acesso },
      }),
      db.episode.updateMany({
        where: { novelaId: dados.novelaId, number: { gt: abertos } },
        data: { accessTier: dados.acesso },
      }),
      // Os primeiros episódios continuam abertos: é o que deixa alguém
      // experimentar a história antes de decidir pagar.
      db.episode.updateMany({
        where: { novelaId: dados.novelaId, number: { lte: abertos } },
        data: { accessTier: "FREE" },
      }),
    ]);

    await registrarAuditoria(operador, {
      action: "catalogo.novela.acesso",
      targetType: "Novela",
      targetId: novela.id,
      targetLabel: novela.title,
      after: { acesso: dados.acesso, gratuitosAte: abertos },
      severity: "WARNING",
    });

    revalidatePath("/painel/catalogo");
    revalidatePath(`/painel/catalogo/${dados.novelaId}`);

    return {
      ok: true,
      mensagem:
        dados.acesso === "FREE"
          ? `${novela._count.episodes} episódios abertos.`
          : `${novela._count.episodes} episódios em ${dados.acesso.toLowerCase()}` +
            (abertos > 0 ? `, com os ${abertos} primeiros abertos.` : "."),
    };
  } catch (erro) {
    return tratarErro(erro, "aplicarAcessoEmLote");
  }
}

/**
 * Numera os episódios como título.
 *
 * A importação nomeia "Episódio 1" porque o nome do arquivo não carrega
 * título de verdade. Quem tiver os títulos os digita; quem não tiver fica com
 * a numeração, que é honesta.
 */
const renomearSchema = z.object({
  novelaId: z.string().min(1),
  titulos: z.array(z.object({ episodioId: z.string(), titulo: z.string().trim().max(200) })).max(500),
});

export async function renomearEpisodios(
  entrada: z.infer<typeof renomearSchema>,
): Promise<ResultadoDaAcao> {
  try {
    const operador = await exigirPermissaoNaAcao("catalogo.editar");
    const dados = renomearSchema.parse(entrada);

    const novela = await db.novela.findUnique({
      where: { id: dados.novelaId },
      select: { title: true },
    });
    if (!novela) return { ok: false, erro: "Novela não encontrada." };

    const validos = dados.titulos.filter((t) => t.titulo.length > 0);
    if (validos.length === 0) return { ok: true, mensagem: "Nada a renomear." };

    await db.$transaction(
      validos.map((t) =>
        db.episode.update({
          where: { id: t.episodioId },
          data: { title: t.titulo },
        }),
      ),
    );

    await registrarAuditoria(operador, {
      action: "catalogo.episodios.renomear",
      targetType: "Novela",
      targetId: dados.novelaId,
      targetLabel: novela.title,
      after: { episodios: validos.length },
      severity: "INFO",
    });

    revalidatePath(`/painel/catalogo/${dados.novelaId}`);
    return { ok: true, mensagem: `${validos.length} episódio(s) renomeado(s).` };
  } catch (erro) {
    return tratarErro(erro, "renomearEpisodios");
  }
}
