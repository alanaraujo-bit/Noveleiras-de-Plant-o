"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState } from "react";

import { Folha } from "@/components/ui/Folha";
import { Avatar } from "@/components/ui/primitivos";
import { IconeOlho, IconeSeta } from "@/components/ui/icones";
import { useToast } from "@/components/sistema/ToastProvider";
import { carregarComentarios, comentarEpisodio } from "@/lib/actions/reel";
import { formatRelative } from "@/lib/format";
import type { ComentarioDeEpisodio } from "@/lib/repositories/episodio-social";
import type { LaminaReel } from "@/lib/repositories/reel";

/**
 * Comentários do episódio.
 *
 * A lista chega só quando a folha abre. Carregar comentários junto com a fila
 * seria pagar por dezenas de conversas que ninguém vai ler — no reel, a
 * maioria das lâminas passa sem um toque neste ícone.
 *
 * O comentário recém-escrito aparece antes de o servidor confirmar, através de
 * `useOptimistic`. Numa folha que sobe sobre o vídeo, esperar o servidor para
 * mostrar a própria frase faria a pessoa achar que o envio falhou e escrever
 * de novo.
 */

export function FolhaComentarios({
  lamina,
  temConta,
  aoFechar,
  aoMudarTotal,
}: {
  lamina: LaminaReel;
  temConta: boolean;
  aoFechar: () => void;
  aoMudarTotal: (total: number) => void;
}) {
  const toast = useToast();
  const [comentarios, setComentarios] = useState<ComentarioDeEpisodio[] | null>(
    null,
  );
  const [pendentes, setPendentes] = useOptimistic<ComentarioDeEpisodio[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelado = false;
    void carregarComentarios(lamina.episodio.id)
      .then((resultado) => {
        if (!cancelado) setComentarios(resultado.comentarios);
      })
      .catch(() => {
        if (!cancelado) setComentarios([]);
      });
    return () => {
      cancelado = true;
    };
  }, [lamina.episodio.id]);

  const total = (comentarios?.length ?? lamina.social.comentarios) + pendentes.length;

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={
        total === 0
          ? "Comentários"
          : total === 1
            ? "1 comentário"
            : `${total} comentários`
      }
    >
      <p className="-mt-1 mb-4 truncate text-[0.8125rem] text-cream-600">
        {lamina.novela.titulo} · T{lamina.episodio.temporada} · Episódio{" "}
        {lamina.episodio.numero}
      </p>

      {temConta ? (
        <form
          ref={formRef}
          className="mb-5 flex items-end gap-2"
          action={async (dados: FormData) => {
            const texto = String(dados.get("comentario") ?? "").trim();
            if (texto.length < 2) return;

            // `reset` direto no DOM e o setter otimista valem neste quadro;
            // um `useState` dentro da transição só apareceria no fim dela, e o
            // campo ficaria preenchido enquanto a rede responde.
            formRef.current?.reset();

            const provisorio: ComentarioDeEpisodio = {
              id: `pendente-${crypto.randomUUID()}`,
              body: texto,
              spoiler: false,
              createdAt: new Date().toISOString(),
              isOwn: true,
              author: {
                id: "eu",
                name: "Você",
                handle: "voce",
                avatarSeed: "1",
                avatarUrl: null,
              },
            };
            setPendentes((atuais) => [provisorio, ...atuais]);

            const resultado = await comentarEpisodio({
              episodeId: lamina.episodio.id,
              body: texto,
            });

            if (!resultado.ok) {
              toast.show(
                resultado.motivo === "sem-conta"
                  ? "Entre para comentar."
                  : "Não deu para publicar agora.",
                "ruim",
              );
              return;
            }

            setComentarios((atuais) => [resultado.comentario, ...(atuais ?? [])]);
            aoMudarTotal(resultado.total);
          }}
        >
          <textarea
            name="comentario"
            rows={1}
            maxLength={600}
            placeholder="Comente este episódio…"
            className="selectable min-h-11 flex-1 resize-none rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-[0.9375rem] text-cream-50 placeholder:text-cream-600"
            onInput={(evento) => {
              const campo = evento.currentTarget;
              campo.style.height = "auto";
              campo.style.height = `${Math.min(campo.scrollHeight, 140)}px`;
            }}
            onKeyDown={(evento) => {
              // Enter publica, Shift+Enter quebra linha — o mesmo contrato de
              // qualquer campo de conversa.
              if (evento.key === "Enter" && !evento.shiftKey) {
                evento.preventDefault();
                evento.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            aria-label="Publicar comentário"
            className="tap grid size-11 shrink-0 place-items-center rounded-full bg-rose-600 text-white"
          >
            <IconeSeta tamanho={18} className="-rotate-90" />
          </button>
        </form>
      ) : (
        <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5">
          <p className="text-[0.875rem] text-cream-400">
            Entre para comentar e acompanhar as respostas.
          </p>
          <Link
            href="/entrar"
            className="tap mt-3 inline-flex h-10 items-center rounded-full bg-cream-50 px-4 text-[0.875rem] font-bold text-ink-950"
          >
            Entrar
          </Link>
        </div>
      )}

      <ul className="space-y-4 pb-2">
        {[...pendentes, ...(comentarios ?? [])].map((comentario) => (
          <li key={comentario.id} className="flex gap-3">
            <Avatar
              nome={comentario.author.name}
              seed={comentario.author.avatarSeed}
              fotoUrl={comentario.author.avatarUrl}
              tamanho={34}
            />
            <div
              className={`min-w-0 flex-1 ${
                comentario.id.startsWith("pendente-") ? "opacity-55" : ""
              }`}
            >
              <p className="flex items-baseline gap-2">
                <span className="truncate text-[0.8125rem] font-semibold text-cream-100">
                  {comentario.author.name}
                </span>
                <span className="shrink-0 text-[0.6875rem] text-cream-600">
                  {formatRelative(comentario.createdAt)}
                </span>
              </p>
              <ComentarioCorpo comentario={comentario} />
            </div>
          </li>
        ))}
      </ul>

      {comentarios === null ? (
        <ul className="space-y-4 pb-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-3">
              <span className="skeleton size-[34px] rounded-full" />
              <span className="skeleton h-10 flex-1 rounded-xl" />
            </li>
          ))}
        </ul>
      ) : null}

      {comentarios !== null && comentarios.length === 0 && pendentes.length === 0 ? (
        <p className="py-6 text-center text-[0.875rem] text-cream-600">
          Ninguém comentou ainda. Comece a conversa.
        </p>
      ) : null}
    </Folha>
  );
}

/**
 * Corpo do comentário, com a tampa de spoiler.
 *
 * A tampa é local e por comentário: revelar um não revela os outros, porque a
 * pessoa que decide ver um palpite sobre o episódio 3 não decidiu ver os
 * palpites sobre o 30.
 */
function ComentarioCorpo({ comentario }: { comentario: ComentarioDeEpisodio }) {
  const [revelado, setRevelado] = useState(false);

  if (comentario.spoiler && !revelado) {
    return (
      <button
        type="button"
        onClick={() => setRevelado(true)}
        className="tap mt-1 flex items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-[0.8125rem] font-semibold text-gold-400"
      >
        <IconeOlho tamanho={15} fechado />
        Contém spoiler · tocar para ver
      </button>
    );
  }

  return (
    <p className="selectable mt-0.5 whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-cream-200">
      {comentario.body}
    </p>
  );
}
