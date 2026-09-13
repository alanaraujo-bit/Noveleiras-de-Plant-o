import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { getPessoa } from "@/lib/repositories/elenco";
import { IconeVoltar } from "@/components/ui/icones";
import { initials } from "@/lib/text";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const pessoa = await getPessoa(slug);
  return { title: pessoa?.name ?? "Elenco" };
}

/**
 * A página de quem atua.
 *
 * Existe para responder uma pergunta só, a que faz alguém tocar num nome:
 * "onde mais eu vi essa pessoa?". Por isso as capas ocupam a tela e o texto é
 * curto — a resposta é visual.
 *
 * O que não temos não aparece. A origem do catálogo não publica foto nem
 * biografia; a foto vira um monograma com a cor da pessoa e a biografia só
 * existe depois que alguém escrever no painel. Um espaço reservado dizendo
 * "sem informações" seria ocupar a tela para anunciar uma falta.
 */
export default async function PessoaPage({ params }: Params) {
  const { slug } = await params;
  const pessoa = await getPessoa(slug);
  if (!pessoa) notFound();

  const total = pessoa.novelas.length;

  return (
    <div>
      <header
        className="relative px-5 pb-6"
        style={{ paddingTop: "calc(var(--safe-t) + 0.75rem)" }}
      >
        <Link
          href="/explorar"
          aria-label="Voltar"
          className="tap -ml-2 mb-5 grid size-10 place-items-center rounded-full text-cream-200 hover:bg-white/8"
        >
          <IconeVoltar tamanho={20} />
        </Link>

        <div className="flex items-center gap-4">
          <Retrato nome={pessoa.name} fotoUrl={pessoa.fotoUrl} />
          <div className="min-w-0">
            <h1 className="text-[1.625rem] leading-tight text-balance-pt">
              {pessoa.name}
            </h1>
            <p className="mt-1 text-[0.875rem] text-cream-400">
              {total === 1 ? "1 novela no plantão" : `${total} novelas no plantão`}
            </p>
          </div>
        </div>

        {pessoa.bio ? (
          <p className="selectable mt-5 text-[0.9375rem] leading-relaxed text-cream-200">
            {pessoa.bio}
          </p>
        ) : null}
      </header>

      <section>
        <h2 className="mb-3.5 px-5 text-[1.125rem] leading-tight">
          {total === 1 ? "No plantão" : "Todas as novelas"}
        </h2>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 px-5">
          {pessoa.novelas.map((novela, indice) => (
            <li key={novela.id}>
              <Link href={`/novela/${novela.slug}`} className="tap group block">
                <div
                  className="relative overflow-hidden rounded-card border border-white/8 bg-ink-850 shadow-poster transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-soft)] group-hover:-translate-y-1 group-hover:shadow-lift"
                  style={{ aspectRatio: "2 / 3" }}
                >
                  <img
                    src={novela.posterUrl}
                    alt=""
                    loading={indice < 4 ? "eager" : "lazy"}
                    decoding="async"
                    className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
                  />
                </div>
                <h3 className="mt-2.5 line-clamp-2 px-0.5 font-display text-[0.9375rem] font-semibold leading-[1.18] text-cream-50">
                  {novela.title}
                </h3>
                <p className="mt-1 truncate px-0.5 text-[0.75rem] font-medium text-cream-600">
                  {[`${novela.episodeCount} eps.`, novela.genero]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * O retrato.
 *
 * Sem foto, o monograma: as iniciais sobre a cor que o nome gera. É o mesmo
 * princípio do avatar de quem assiste, e por isso a tela não parece estar
 * esperando uma imagem que nunca vem. Quando a foto existir, ela entra aqui
 * sem mudar mais nada.
 */
function Retrato({ nome, fotoUrl }: { nome: string; fotoUrl: string | null }) {
  // A cor vem do nome: a mesma pessoa tem sempre o mesmo retrato, em qualquer
  // tela, sem guardar nada.
  const matiz = [...nome].reduce((soma, letra) => soma + letra.charCodeAt(0), 0) % 360;

  return (
    <span
      aria-hidden
      className="grid size-[4.5rem] shrink-0 place-items-center overflow-hidden rounded-full font-display text-[1.375rem] font-semibold text-cream-50"
      style={{
        background: fotoUrl
          ? undefined
          : `linear-gradient(150deg, oklch(52% 0.13 ${matiz}), oklch(32% 0.09 ${matiz}))`,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.16)",
      }}
    >
      {fotoUrl ? (
        <img src={fotoUrl} alt="" className="size-full object-cover" />
      ) : (
        initials(nome)
      )}
    </span>
  );
}
