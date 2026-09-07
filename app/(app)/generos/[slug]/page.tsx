import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getGenreWithNovelas } from "@/lib/repositories/catalog";
import { Capa } from "@/components/novela/cartoes";
import { RegistrarAberturaGenero } from "./RegistrarAberturaGenero";
import { IconeVoltar } from "@/components/ui/icones";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const dados = await getGenreWithNovelas(slug);
  if (!dados) return { title: "Gênero não encontrado" };
  return { title: dados.genre.name, description: dados.genre.tagline };
}

export default async function GeneroPage({ params }: Params) {
  const { slug } = await params;
  const dados = await getGenreWithNovelas(slug);
  if (!dados) notFound();

  const { genre, novelas } = dados;

  return (
    <div>
      <RegistrarAberturaGenero generoId={genre.id} slug={genre.slug} />

      <header className="relative">
        <div className="relative" style={{ aspectRatio: "3 / 2" }}>
          <img
            src={`/api/arte/genero/${genre.slug}`}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-ink-950/40" />
        </div>

        <Link
          href="/generos"
          aria-label="Voltar para gêneros"
          className="tap absolute left-4 grid size-10 place-items-center rounded-full bg-ink-950/55 text-cream-50 backdrop-blur-sm"
          style={{ top: "calc(var(--safe-t) + 0.75rem)" }}
        >
          <IconeVoltar tamanho={20} />
        </Link>

        <div className="absolute inset-x-0 bottom-0 px-5 pb-1">
          <h1 className="text-[1.875rem] leading-tight">{genre.name}</h1>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-cream-200">
            {genre.tagline}
          </p>
        </div>
      </header>

      <p className="px-5 pb-3 pt-4 text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-cream-600">
        {novelas.length} {novelas.length === 1 ? "novela" : "novelas"}
      </p>

      <ul className="grid grid-cols-3 gap-2.5 px-5">
        {novelas.map((novela) => (
          <li key={novela.id}>
            <Capa novela={novela} largura="cheia" />
          </li>
        ))}
      </ul>
    </div>
  );
}
