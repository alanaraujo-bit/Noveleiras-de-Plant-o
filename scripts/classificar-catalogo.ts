/**
 * Reclassifica o catálogo já importado a partir dos manifestos.
 *
 * A importação lê a biblioteca inteira e sonda vídeo: é cara e demorada.
 * Quando o que mudou foi só o vocabulário — a origem passou a mandar temas, ou
 * a nossa tabela de gêneros mudou —, refazer a importação inteira seria pagar
 * pelo disco para atualizar texto. Este comando lê apenas os `manifest.json` e
 * regrava o que sai deles: elenco, tags, gêneros, país e classificação.
 *
 * O que uma pessoa escreveu fica de pé. Sinopse, tagline e capa não são
 * tocadas aqui, e o elenco só é preenchido onde está vazio.
 *
 *   npm run catalogo:classificar
 *   npm run catalogo:classificar -- --aplicar
 *   npm run catalogo:classificar -- --aplicar --refazer-generos
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

import { slugificar, textoDeBusca } from "../lib/media/biblioteca.ts";
import {
  classificarTemas,
  paraElenco,
  type TemaDaOrigem,
} from "../lib/media/temas.ts";
import { garantirGeneros, vincularGeneros } from "../lib/media/generos.ts";

const db = new PrismaClient();

function argumento(nome: string, padrao?: string): string | undefined {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
}

const APLICAR = process.argv.includes("--aplicar");
/** Sem isto, só ganha gênero quem ainda não tem nenhum. */
const REFAZER = process.argv.includes("--refazer-generos");
const RAIZ = argumento("raiz", process.env.BIBLIOTECA_RAIZ)!;

type Manifesto = {
  dramaName?: string;
  themes?: { key?: string; value?: string; group?: string | number }[];
};

async function lerManifesto(pasta: string): Promise<Manifesto | null> {
  try {
    return JSON.parse(
      await readFile(join(pasta, "manifest.json"), "utf8"),
    ) as Manifesto;
  } catch {
    return null;
  }
}

async function main() {
  if (!RAIZ) {
    console.error(
      "\n  Diga onde fica a biblioteca:" +
        '\n    npm run catalogo:classificar -- --raiz="D:/Noveleiras de Plantão"' +
        "\n  ou defina BIBLIOTECA_RAIZ no .env\n",
    );
    process.exit(1);
  }

  console.log(`\n  Lendo manifestos em ${RAIZ}\n`);

  const generoPorSlug = APLICAR
    ? await garantirGeneros(db)
    : new Map<string, string>();

  const pastas = (await readdir(RAIZ, { withFileTypes: true })).filter((p) =>
    p.isDirectory(),
  );

  let semManifesto = 0;
  let semTema = 0;
  let semGenero = 0;
  let comElenco = 0;
  let atualizadas = 0;
  let vinculos = 0;
  const foraDoCatalogo: string[] = [];
  const porGenero = new Map<string, number>();

  for (const pasta of pastas) {
    const manifesto = await lerManifesto(join(RAIZ, pasta.name));
    if (!manifesto) {
      semManifesto += 1;
      continue;
    }

    const titulo = manifesto.dramaName?.trim() || pasta.name;
    const slug = slugificar(titulo);
    const novela = await db.novela.findUnique({
      where: { slug },
      select: { id: true, synopsis: true, tags: true, cast: true, _count: { select: { genres: true } } },
    });
    if (!novela) {
      foraDoCatalogo.push(titulo);
      continue;
    }

    const temas: TemaDaOrigem[] = (manifesto.themes ?? [])
      .map((tema) => ({
        chave: tema?.key?.trim() ?? "",
        valor: tema?.value?.trim() ?? "",
        grupo: tema?.group != null ? String(tema.group).trim() : "",
      }))
      .filter((tema) => tema.valor !== "");
    if (temas.length === 0) {
      semTema += 1;
      continue;
    }

    const classificacao = classificarTemas(temas);
    if (classificacao.generos.length === 0) semGenero += 1;
    if (classificacao.elenco.length > 0) comElenco += 1;
    for (const slugGenero of classificacao.generos) {
      porGenero.set(slugGenero, (porGenero.get(slugGenero) ?? 0) + 1);
    }

    const elencoGravado = Array.isArray(novela.cast) ? novela.cast : [];
    const escreveElenco =
      classificacao.elenco.length > 0 && elencoGravado.length === 0;

    console.log(
      `  ${titulo.slice(0, 46).padEnd(46)} ${String(classificacao.tags.length).padStart(2)} tags · ` +
        `${classificacao.generos.join(", ") || "sem gênero"}` +
        `${escreveElenco ? ` · elenco: ${classificacao.elenco.join(", ")}` : ""}`,
    );

    if (!APLICAR) continue;

    await db.novela.update({
      where: { id: novela.id },
      data: {
        tags: classificacao.tags,
        searchText: textoDeBusca(
          titulo,
          novela.synopsis,
          classificacao.tags.join(" "),
          classificacao.elenco.join(" "),
        ),
        ...(escreveElenco ? { cast: paraElenco(classificacao.elenco) } : {}),
        ...(classificacao.pais ? { country: classificacao.pais } : {}),
        ...(classificacao.classificacao
          ? { ageRating: classificacao.classificacao }
          : {}),
      },
    });
    atualizadas += 1;

    // Sem `--refazer-generos`, uma novela que já tem gênero fica como está: o
    // vínculo pode ter sido feito à mão no painel, e regravar apagaria isso.
    if (REFAZER || novela._count.genres === 0) {
      vinculos += await vincularGeneros(
        db,
        novela.id,
        classificacao.generos,
        generoPorSlug,
      );
    }
  }

  console.log(
    `\n  ${pastas.length} pasta(s) · ${semManifesto} sem manifesto · ${semTema} sem tema`,
  );
  console.log(
    `  ${semGenero} novela(s) que os temas não classificam (a vitrine lê o texto nessas)`,
  );
  console.log(`  ${comElenco} novela(s) com elenco na origem`);
  if (foraDoCatalogo.length > 0) {
    console.log(
      `  ${foraDoCatalogo.length} pasta(s) fora do catálogo — importe antes: ${foraDoCatalogo.slice(0, 3).join(", ")}${foraDoCatalogo.length > 3 ? "…" : ""}`,
    );
  }

  console.log("\n  Gêneros:");
  for (const [slug, n] of [...porGenero].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}  ${slug}`);
  }

  if (!APLICAR) {
    console.log("\n  Nada foi gravado. Repita com --aplicar.\n");
    return;
  }
  console.log(
    `\n  ${atualizadas} novela(s) atualizada(s) · ${vinculos} vínculo(s) de gênero\n`,
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
