import Link from "next/link";

import {
  listGenresWithHighlights,
  type GenreWithHighlights,
} from "@/lib/repositories/catalog";

export const metadata = { title: "Gêneros" };

function MontagemCapas({ genero }: { genero: GenreWithHighlights }) {
  const [principal, secundaria, terceira] = genero.highlights;

  if (!principal) {
    return (
      <img
        src={genero.artUrl}
        alt=""
        loading="lazy"
        className="size-full object-cover"
      />
    );
  }

  if (!secundaria) {
    return (
      <img
        src={principal.posterUrl}
        alt=""
        loading="lazy"
        className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.025]"
      />
    );
  }

  return (
    <div className="flex size-full" aria-hidden="true">
      <div className="relative w-3/5 overflow-hidden">
        <img
          src={principal.posterUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.025]"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-l border-white/10">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <img
            src={secundaria.posterUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.025]"
          />
        </div>

        {terceira ? (
          <div className="relative min-h-0 flex-1 overflow-hidden border-t border-white/10">
            <img
              src={terceira.posterUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.025]"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default async function GenerosPage() {
  const generos = await listGenresWithHighlights();

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
              className="tap group block overflow-hidden rounded-card border border-white/8 bg-ink-850"
            >
              <div className="aspect-[4/3] overflow-hidden bg-ink-800">
                <MontagemCapas genero={genero} />
              </div>

              <div className="border-t border-white/8 p-3.5">
                <h2 className="text-[1.125rem] leading-tight">{genero.name}</h2>
                <p className="mt-1 min-h-8 line-clamp-2 text-[0.75rem] leading-snug text-cream-400">
                  {genero.tagline}
                </p>
                <p className="mt-1.5 text-[0.6875rem] font-semibold text-gold-400">
                  {genero.novelaCount}{" "}
                  {genero.novelaCount === 1 ? "novela" : "novelas"}
                </p>
                {genero.highlights.length > 0 ? (
                  <span className="sr-only">
                    Em destaque: {genero.highlights.map(({ title }) => title).join(", ")}.
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
