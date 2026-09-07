import Link from "next/link";

import { Selo, Td } from "@/components/painel/primitivos";

/**
 * Peças de leitura da comunidade.
 *
 * Separadas de `ComunidadeAcoes` de propósito: um módulo "use client" só
 * exporta referências de cliente, então um rótulo importado de lá para um
 * Server Component chega como proxy e a busca no mapa devolve undefined —
 * foi assim que "teoria" virou "theory" na tela.
 */

export const ROTULO_DE_TIPO: Record<string, string> = {
  THOUGHT: "comentário solto",
  REVIEW: "resenha",
  THEORY: "teoria",
};

export const ROTULO_DE_ESTADO: Record<string, string> = {
  OPEN: "aberta",
  REVIEWING: "em análise",
  RESOLVED: "resolvida",
  DISMISSED: "improcedente",
};

export function SeloDeEstado({ estado }: { estado: string }) {
  return (
    <Selo
      tom={
        estado === "OPEN"
          ? "perigo"
          : estado === "REVIEWING"
            ? "atencao"
            : estado === "RESOLVED"
              ? "bom"
              : "neutro"
      }
    >
      {ROTULO_DE_ESTADO[estado] ?? estado.toLowerCase()}
    </Selo>
  );
}

/** Autor com link para a ficha, quando quem olha pode abri-la. */
export function CelulaDeAutor({
  autor,
  podeAbrirContas,
  ausente = "conta removida",
}: {
  autor: { id: string; nome: string; handle: string; demo?: boolean } | null;
  podeAbrirContas: boolean;
  /** O que dizer quando não há autor — some por remoção não é o mesmo que nunca ter havido um. */
  ausente?: string;
}) {
  if (!autor) {
    return (
      <Td>
        <span className="text-[var(--p-fraco)]">{ausente}</span>
      </Td>
    );
  }

  const nome = (
    <>
      <span className="block truncate">{autor.nome}</span>
      <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
        @{autor.handle}
        {autor.demo ? " · demonstração" : ""}
      </span>
    </>
  );

  return (
    <Td>
      <span className="block max-w-[12rem]">
        {podeAbrirContas ? (
          <Link
            href={`/painel/usuarios/${autor.id}`}
            className="block hover:text-[var(--color-rose-300)]"
          >
            {nome}
          </Link>
        ) : (
          nome
        )}
      </span>
    </Td>
  );
}
