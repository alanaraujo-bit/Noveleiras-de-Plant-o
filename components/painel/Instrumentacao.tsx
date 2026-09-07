import type { ReactNode } from "react";

import { Selo } from "@/components/painel/primitivos";

/**
 * Estado "instrumentado, ainda não alimentado".
 *
 * Existe porque uma tabela vazia tem dois significados opostos e confundi-los
 * custa caro numa operação: *nada aconteceu* é notícia boa; *nada está sendo
 * medido* é dívida. As telas de infraestrutura estão no segundo caso — o
 * schema existe, as consultas funcionam, e nenhum processo escreve ainda.
 *
 * A alternativa seria esconder essas telas do menu, e aí o mapa do painel
 * mentiria por omissão. Preferimos a tela que diz exatamente o que falta
 * ligar, com o nome da tabela e o gesto que a preencheria.
 */
export function AguardandoInstrumentacao({
  oQue,
  tabela,
  comoLigar,
  oQueVaiMostrar,
  extra,
}: {
  /** O que esta tela mede, em uma frase. */
  oQue: string;
  /** A tabela que deveria estar recebendo linhas. */
  tabela: string;
  /** Quem deveria escrever nela, e o que falta para isso. */
  comoLigar: ReactNode;
  /** O que a tela passa a mostrar assim que a primeira linha chegar. */
  oQueVaiMostrar: string[];
  extra?: ReactNode;
}) {
  return (
    <section className="painel-cartao overflow-hidden">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-[var(--p-linha)] px-5 py-4">
        <Selo tom="atencao">aguardando instrumentação</Selo>
        <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
          {oQue}
        </h2>
      </header>

      <div className="grid gap-x-8 gap-y-5 px-5 py-5 lg:grid-cols-2">
        <div>
          <p className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
            Por que está vazia
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--p-suave)]">
            A tabela{" "}
            <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">
              {tabela}
            </code>{" "}
            existe, está indexada e esta tela lê dela corretamente. Nenhum
            processo escreve nela ainda — o vazio aqui é falta de fonte, não
            falta de acontecimento.
          </p>
          <div className="mt-3 text-[0.8125rem] leading-relaxed text-[var(--p-suave)]">
            {comoLigar}
          </div>
        </div>

        <div>
          <p className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
            O que aparece assim que a primeira linha chegar
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {oQueVaiMostrar.map((item) => (
              <li
                key={item}
                className="flex gap-2 text-[0.8125rem] leading-relaxed text-[var(--p-suave)]"
              >
                <span aria-hidden className="text-[var(--p-fraco)]">
                  ·
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {extra ? (
        <div className="border-t border-[var(--p-linha)] px-5 py-4">{extra}</div>
      ) : null}
    </section>
  );
}

/**
 * Estado "instrumentado e sem nada a mostrar".
 *
 * O oposto do de cima, e a distinção é o ponto: aqui a fonte existe e está
 * escrevendo — só não houve o que registrar. Silêncio assim costuma ser boa
 * notícia (nenhum incidente) ou apenas trabalho que ninguém pediu ainda, e nos
 * dois casos a tela deve dizer qual dos dois é, com o próximo passo à mão.
 */
export function NadaAconteceu({
  titulo,
  porQue,
  proximoPasso,
  fonte,
}: {
  titulo: string;
  porQue: string;
  proximoPasso?: ReactNode;
  /** O que prova que a instrumentação está viva. */
  fonte: string;
}) {
  return (
    <section className="painel-cartao overflow-hidden">
      <div className="px-6 py-10 text-center">
        <p className="text-[0.9375rem] font-medium text-[var(--p-suave)]">
          {titulo}
        </p>
        <p className="mx-auto mt-2 max-w-[62ch] text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
          {porQue}
        </p>
        {proximoPasso ? (
          <div className="mt-4 text-[0.8125rem] text-[var(--p-suave)]">
            {proximoPasso}
          </div>
        ) : null}
        <p className="mx-auto mt-5 max-w-max rounded-md bg-[var(--p-elevado)] px-2.5 py-1 text-[0.6875rem] text-[var(--p-fraco)]">
          {fonte}
        </p>
      </div>
    </section>
  );
}
