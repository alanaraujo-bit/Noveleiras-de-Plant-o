import Link from "next/link";

import { listGenres } from "@/lib/repositories/catalog";

export const metadata = { title: "Gêneros" };

export default async function GenerosPage() {
  const generos = await listGenres();

  return (
    <div>
      <header
        className="px-5 pb-5"
        style={{ paddingTop: "calc(var(--safe-t) + 1.25rem)" }}
      >
        <p className="eyebrow">Por onde começar</p>
        <h1 className="mt-1.5 text-[1.875rem] leading-tight">Gêneros</h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-cream-400">
          Escolha o tipo de drama que combina com o seu dia.
        </p>
      </header>

      <ul className="grid grid-cols-2 gap-3 px-5">
        {generos.map((genero) => (
          <li key={genero.id}>
            <Link
              href={`/generos/${genero.slug}`}
              className="tap relative block overflow-hidden rounded-card border border-white/8"
              style={{ aspectRatio: "4 / 5" }}
            >
              <img
                src={genero.artUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/92 via-ink-950/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3.5">
                <h2 className="text-[1.125rem] leading-tight">{genero.name}</h2>
                <p className="mt-1 line-clamp-2 text-[0.75rem] leading-snug text-cream-400">
                  {genero.tagline}
                </p>
                <p className="mt-1.5 text-[0.6875rem] font-semibold text-gold-400">
                  {genero.novelaCount}{" "}
                  {genero.novelaCount === 1 ? "novela" : "novelas"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
