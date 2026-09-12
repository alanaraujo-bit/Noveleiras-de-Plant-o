"use client";

import { motion } from "motion/react";

import { Folha } from "@/components/ui/Folha";

/**
 * "Como você prefere pagar?"
 *
 * A única pergunta que separa uma pessoa do catálogo, e ela tem que ser
 * respondível em segundos, sem ler nada duas vezes. Por isso a tela diz o
 * preço e **uma** frase sobre o que acontece no mês seguinte — que é a única
 * diferença real entre as duas opções. O benefício é idêntico, então repeti-lo
 * dos dois lados só faria a pessoa procurar a diferença onde ela não está.
 *
 * O que deliberadamente não aparece aqui: recorrência, cobrança automática,
 * assinatura recorrente, ciclo, carência. Quem veio assistir novela não deve
 * precisar aprender vocabulário financeiro para apertar um botão.
 */

export type ModoDePagamento = "CARD" | "PIX";

function reais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const OPCOES: Array<{
  modo: ModoDePagamento;
  titulo: string;
  promessa: (preco: string) => string;
  detalhe: string;
  cor: string;
  Icone: () => React.ReactElement;
}> = [
  {
    modo: "CARD",
    titulo: "Cartão",
    promessa: (preco) => `${preco} por mês`,
    detalhe: "Renova automaticamente todos os meses.",
    cor: "#e03a69",
    Icone: IconeCartao,
  },
  {
    modo: "PIX",
    titulo: "Pix",
    promessa: (preco) => preco,
    detalhe: "Você ganha 1 mês e renova quando quiser.",
    cor: "#d9a355",
    Icone: IconePix,
  },
];

export function ComoPrefereModo({
  aberta,
  aoFechar,
  precoCents,
  processando,
  aoEscolher,
}: {
  aberta: boolean;
  aoFechar: () => void;
  precoCents: number;
  /** Qual opção está abrindo a cobrança agora, se alguma. */
  processando: ModoDePagamento | null;
  aoEscolher: (modo: ModoDePagamento) => void;
}) {
  const preco = reais(precoCents);

  return (
    <Folha aberta={aberta} aoFechar={aoFechar} titulo="Como você prefere pagar?">
      <ul className="space-y-2.5 px-1 pb-2">
        {OPCOES.map((opcao, indice) => {
          const ocupada = processando !== null;
          const estaAbrindo = processando === opcao.modo;

          return (
            <motion.li
              key={opcao.modo}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: indice * 0.05, duration: 0.28 }}
            >
              <button
                type="button"
                disabled={ocupada}
                onClick={() => aoEscolher(opcao.modo)}
                aria-label={`${opcao.titulo}: ${opcao.promessa(preco)}. ${opcao.detalhe}`}
                className="tap flex w-full items-center gap-4 rounded-3xl border p-4 text-left transition-colors disabled:opacity-60"
                style={{
                  borderColor: `${opcao.cor}45`,
                  background: `linear-gradient(150deg, ${opcao.cor}16, rgb(255 255 255/0.02) 70%)`,
                }}
              >
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-2xl"
                  style={{ background: `${opcao.cor}22`, color: opcao.cor }}
                >
                  <opcao.Icone />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[1.0625rem] font-semibold text-cream-50">
                      {opcao.titulo}
                    </span>
                    <span
                      className="text-[0.9375rem] font-bold"
                      style={{ color: opcao.cor }}
                    >
                      {opcao.promessa(preco)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-snug text-cream-400">
                    {estaAbrindo ? "Preparando…" : opcao.detalhe}
                  </span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>

      <p className="px-2 pb-1 pt-3 text-center text-[0.75rem] leading-relaxed text-cream-600">
        Nos dois jeitos você vê o catálogo inteiro. Muda só como o próximo mês
        acontece.
      </p>
    </Folha>
  );
}

function IconeCartao() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 10h19" />
      <path d="M6.5 15h3" />
    </svg>
  );
}

function IconePix() {
  // O losango do Pix, desenhado e não baixado: um ícone remoto numa tela de
  // pagamento é uma requisição a mais que pode não chegar bem na hora errada.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12z" />
      <path d="M8.4 8.4 12 12l3.6-3.6" />
    </svg>
  );
}
