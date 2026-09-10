"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  IconeCompartilhar,
  IconeConversa,
  IconeCoracaoCheio,
} from "@/components/ui/icones";
import { formatCount } from "@/lib/format";
import type { LaminaReel } from "@/lib/repositories/reel";

/**
 * Coluna de ações da lâmina: curtir, comentar, enviar.
 *
 * Três ações, nesta ordem, e nada mais. A tentação de acrescentar salvar,
 * seguir, denunciar e velocidade é constante — e cada item novo rouba pixel de
 * cena e atenção de decisão. O que precisa de mais de três ações mora na
 * página da novela, a um toque de distância no título.
 *
 * O número embaixo de cada ícone é otimista: aparece no quadro do toque e é
 * reconciliado com o servidor depois. Numa tela onde a pessoa passa três
 * segundos por lâmina, esperar o servidor para pintar um coração é o mesmo que
 * não ter coração nenhum.
 */

export function AcoesLaterais({
  lamina,
  aoCurtir,
  aoAbrirComentarios,
  aoEnviar,
}: {
  lamina: LaminaReel;
  aoCurtir: () => void;
  aoAbrirComentarios: () => void;
  aoEnviar: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute bottom-0 right-0 z-30 flex w-[4.5rem] flex-col items-center gap-[1.125rem] pb-1"
      style={{
        paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 1.25rem)",
      }}
    >
      {/* Cartaz da novela: a identidade da obra, e um atalho para a ficha
          completa. Ocupa o lugar do avatar de criador das redes — aqui o autor
          da lâmina é a novela. */}
      <Link
        href={`/novela/${lamina.novela.slug}`}
        aria-label={`Ver ${lamina.novela.titulo}`}
        className="tap relative mb-0.5 block size-11 overflow-hidden rounded-xl border border-white/25 shadow-poster"
      >
        <img
          src={lamina.novela.posterUrl}
          alt=""
          draggable={false}
          className="size-full object-cover"
        />
      </Link>

      <Acao
        rotulo={lamina.social.curtido ? "Descurtir" : "Curtir"}
        contagem={lamina.social.curtidas}
        ativa={lamina.social.curtido}
        aoTocar={aoCurtir}
        icone={
          <IconeCoracaoCheio
            tamanho={31}
            className={lamina.social.curtido ? "text-rose-500" : "text-white"}
          />
        }
      />

      <Acao
        rotulo="Comentários"
        contagem={lamina.social.comentarios}
        aoTocar={aoAbrirComentarios}
        icone={<IconeConversa tamanho={30} className="text-white" />}
      />

      <Acao
        rotulo="Enviar"
        contagem={lamina.social.envios}
        aoTocar={aoEnviar}
        icone={<IconeCompartilhar tamanho={29} className="text-white" />}
      />
    </div>
  );
}

function Acao({
  rotulo,
  contagem,
  icone,
  ativa = false,
  aoTocar,
}: {
  rotulo: string;
  contagem: number;
  icone: React.ReactNode;
  ativa?: boolean;
  aoTocar: () => void;
}) {
  // O pulso responde à mudança do número, não ao toque: assim a animação
  // acontece quando algo de fato mudou, inclusive numa curtida por toque duplo
  // disparada do meio da tela.
  const [pulso, setPulso] = useState(0);
  const anteriorRef = useRef(contagem);

  useEffect(() => {
    if (anteriorRef.current !== contagem) {
      anteriorRef.current = contagem;
      setPulso((n) => n + 1);
    }
  }, [contagem]);

  return (
    <button
      type="button"
      onClick={aoTocar}
      aria-label={rotulo}
      aria-pressed={ativa || undefined}
      className="tap flex flex-col items-center gap-1"
    >
      <span key={pulso} className={`halo-acao block ${pulso ? "pulso-acao" : ""}`}>
        {icone}
      </span>
      <span className="text-[0.6875rem] font-bold tabular-nums text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]">
        {contagem > 0 ? formatCount(contagem) : ""}
      </span>
    </button>
  );
}
