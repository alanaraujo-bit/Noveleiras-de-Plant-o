/**
 * Importa uma biblioteca de novelas do disco para o catálogo.
 *
 * É o "escanear biblioteca" que faltava. O inventário de mídia confere
 * arquivos contra episódios que já existem; este comando faz o contrário —
 * lê a pasta e **cria** novela, temporada e episódios a partir dela.
 *
 * Duas regras que ele não quebra:
 *
 * 1. **Não inventa texto.** Sinopse, tagline e elenco ficam vazios até alguém
 *    escrever. Um resumo gerado por adivinhação enganaria quem lê o catálogo,
 *    e o painel de Catálogo mostra o que está faltando.
 *
 * 2. **É idempotente.** Rodar de novo atualiza o que mudou e não duplica
 *    nada. A identidade é o slug da novela e o número do episódio.
 *
 * O `manifest.json` da pasta, quando existe, poupa a sondagem: duração,
 * dimensões e codec saem dele. Sem manifesto, o ffmpeg mede.
 *
 *   npm run biblioteca:importar
 *   npm run biblioteca:importar -- --aplicar
 *   npm run biblioteca:importar -- --raiz="D:/Novelas" --aplicar
 */
import { PrismaClient } from "@prisma/client";
import ffmpegPath from "ffmpeg-static";

import {
  corDoTitulo,
  lerBiblioteca,
  slugificar,
  textoDeBusca,
} from "../lib/media/biblioteca.ts";
import { sondar } from "../lib/media/inventario.ts";

const db = new PrismaClient();

function argumento(nome: string, padrao?: string): string | undefined {
  const achado = process.argv.find((item) => item.startsWith(`--${nome}=`));
  return achado ? achado.split("=").slice(1).join("=") : padrao;
}

const APLICAR = process.argv.includes("--aplicar");
const RAIZ = argumento("raiz", process.env.BIBLIOTECA_RAIZ)!;

function bytes(valor: number): string {
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let n = valor;
  let i = 0;
  while (n >= 1024 && i < unidades.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${unidades[i]}`;
}

async function main() {
  if (!RAIZ) {
    console.error(
      "\n  Diga onde fica a biblioteca:" +
        "\n    npm run biblioteca:importar -- --raiz=\"D:/Noveleiras de Plantão\"" +
        "\n  ou defina BIBLIOTECA_RAIZ no .env\n",
    );
    process.exit(1);
  }

  console.log(`\n  Lendo ${RAIZ}\n`);
  const novelas = await lerBiblioteca(RAIZ);
  if (novelas.length === 0) {
    console.log("  Nenhuma pasta de novela encontrada.\n");
    return;
  }

  let totalEpisodios = 0;
  let totalBytes = 0;
  let novasNovelas = 0;
  let novosEpisodios = 0;
  let atualizados = 0;

  for (const novela of novelas) {
    const slug = slugificar(novela.titulo);
    const existente = await db.novela.findUnique({
      where: { slug },
      select: { id: true, title: true },
    });

    totalEpisodios += novela.episodios.length;
    totalBytes += novela.episodios.reduce((s, e) => s + e.tamanhoBytes, 0);

    console.log(
      `  ${existente ? "~" : "+"} ${novela.titulo}` +
        `\n      ${novela.episodios.length} episódios · slug ${slug}` +
        (novela.totalDeclarado &&
        novela.totalDeclarado !== novela.episodios.length
          ? ` · o manifesto declara ${novela.totalDeclarado}`
          : "") +
        (novela.lacunas.length
          ? `\n      ! faltando: ${novela.lacunas.map((n) => `E${String(n).padStart(2, "0")}`).join(", ")}`
          : "") +
        (novela.ignorados.length
          ? `\n      ! ignorado: ${novela.ignorados.join("; ")}`
          : ""),
    );

    if (!existente) novasNovelas += 1;
    if (!APLICAR) continue;

    // ---- a novela ------------------------------------------------------
    // Datas de estreia: a biblioteca não as tem. Usamos a data de hoje para a
    // novela e escalonamos os episódios a partir dela, deixando claro no
    // painel que é publicação e não estreia original.
    const agora = new Date();
    const dadosDaNovela = {
      title: novela.titulo,
      // Vazios de propósito: inventar sinopse enganaria quem lê o catálogo.
      tagline: "",
      synopsis: "",
      status: "ONGOING" as const,
      accessTier: "FREE" as const,
      year: agora.getFullYear(),
      posterKey: `gen:capa/${slug}`,
      heroKey: `gen:hero/${slug}`,
      accent: corDoTitulo(novela.titulo),
      searchText: textoDeBusca(novela.titulo),
      editorialNote: novela.origem
        ? `Importada da pasta "${novela.pasta}" (origem ${novela.origem}).`
        : `Importada da pasta "${novela.pasta}".`,
      releasedAt: agora,
    };

    const gravada = await db.novela.upsert({
      where: { slug },
      create: { slug, ...dadosDaNovela },
      // Sinopse e tagline não são sobrescritas numa reimportação: quem
      // escreveu à mão não perde o texto por rodar o comando de novo.
      update: {
        title: dadosDaNovela.title,
        searchText: dadosDaNovela.searchText,
        accent: dadosDaNovela.accent,
      },
      select: { id: true },
    });

    // ---- a temporada ---------------------------------------------------
    // A biblioteca é plana, então existe uma temporada só. Ela é criada
    // porque o schema exige, não porque o disco a sugere.
    const temporada = await db.season.upsert({
      where: { novelaId_number: { novelaId: gravada.id, number: 1 } },
      create: {
        novelaId: gravada.id,
        number: 1,
        title: "Temporada única",
      },
      update: {},
      select: { id: true },
    });

    // ---- os episódios --------------------------------------------------
    for (const episodio of novela.episodios) {
      // Duração vem do manifesto quando existe; senão o ffmpeg mede, porque
      // um episódio sem duração quebra a barra de progresso do player.
      let duracao = episodio.duracaoSeg;
      if (duracao === null && ffmpegPath) {
        const sondagem = await sondar(episodio.caminho, ffmpegPath);
        duracao = sondagem.duracaoSeg;
      }

      const jaExiste = await db.episode.findUnique({
        where: {
          seasonId_number: { seasonId: temporada.id, number: episodio.numero },
        },
        select: { id: true },
      });

      await db.episode.upsert({
        where: {
          seasonId_number: { seasonId: temporada.id, number: episodio.numero },
        },
        create: {
          seasonId: temporada.id,
          novelaId: gravada.id,
          number: episodio.numero,
          title: `Episódio ${episodio.numero}`,
          synopsis: "",
          durationSec: Math.max(1, Math.round(duracao ?? 0)),
          mediaKey: episodio.chave,
          mediaProvider: "LOCAL",
          mediaFormat: "mp4",
          thumbKey: `gen:capa/${slug}`,
          releasedAt: agora,
        },
        update: {
          mediaKey: episodio.chave,
          durationSec: Math.max(1, Math.round(duracao ?? 0)),
        },
      });

      if (jaExiste) atualizados += 1;
      else novosEpisodios += 1;
    }
  }

  console.log(
    `\n  ${novelas.length} novelas · ${totalEpisodios} episódios · ${bytes(totalBytes)}`,
  );

  if (!APLICAR) {
    console.log("\n  Nada foi gravado. Repita com --aplicar.\n");
    return;
  }

  console.log(
    `  ${novasNovelas} novela(s) nova(s) · ${novosEpisodios} episódio(s) novo(s) · ${atualizados} atualizado(s)`,
  );
  console.log(
    "\n  Catálogo gravado. Falta o vídeo chegar ao espectador:" +
      "\n    1. npm run midia:inventariar -- --raiz=\"" + RAIZ + "\" --aplicar" +
      "\n    2. npm run servidor:midia      (serve os arquivos)" +
      "\n    3. aponte MEDIA_BASE_URL para o endereço do túnel\n",
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
