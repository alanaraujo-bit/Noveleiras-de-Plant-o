"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { alternarCurtida, comentar, publicarNoFeed } from "@/lib/actions/catalogo";
import { useToast } from "@/components/sistema/ToastProvider";
import { useTelemetry } from "@/components/sistema/TelemetryProvider";
import { Folha } from "@/components/ui/Folha";
import { Avatar, Chip, EstadoVazio } from "@/components/ui/primitivos";
import {
  IconeConversa,
  IconeCoracao,
  IconeEstrela,
  IconeMais,
  IconeOlho,
} from "@/components/ui/icones";
import { formatRelative } from "@/lib/format";
import type { FeedPost } from "@/lib/repositories/feed";

/**
 * Plantão da comunidade.
 *
 * Publicações ancoradas numa novela, com curtida, comentário e proteção
 * antispoiler. As curtidas respondem na hora (estado local) e confirmam no
 * servidor depois — a interface nunca fica esperando a rede.
 */

const TIPOS = [
  { valor: "THOUGHT", rotulo: "Comentário" },
  { valor: "REVIEW", rotulo: "Avaliação" },
  { valor: "THEORY", rotulo: "Teoria" },
] as const;

const ROTULO_TIPO: Record<FeedPost["kind"], string> = {
  THOUGHT: "Comentário",
  REVIEW: "Avaliação",
  THEORY: "Teoria",
};

type Props = {
  posts: FeedPost[];
  novelas: { id: string; title: string; accent: string }[];
  viewer: { nome: string; handle: string; avatarSeed: string };
  esconderSpoiler: boolean;
};

export function PainelFeed({ posts, novelas, viewer, esconderSpoiler }: Props) {
  const { show } = useToast();
  const { track } = useTelemetry();
  const [lista, setLista] = useState(posts);
  const [compondo, setCompondo] = useState(false);
  const [revelados, setRevelados] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<"todos" | FeedPost["kind"]>("todos");
  const [compacto, setCompacto] = useState(false);

  useEffect(() => setLista(posts), [posts]);
  useEffect(() => {
    track("FEED_VIEW");
  }, [track]);

  useEffect(() => {
    let ocioso: number | undefined;
    const aoRolar = () => {
      setCompacto(true);
      window.clearTimeout(ocioso);
      ocioso = window.setTimeout(() => setCompacto(false), 700);
    };
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => {
      window.removeEventListener("scroll", aoRolar);
      window.clearTimeout(ocioso);
    };
  }, []);

  const visiveis =
    filtro === "todos" ? lista : lista.filter((post) => post.kind === filtro);

  const curtir = (post: FeedPost) => {
    setLista((atual) =>
      atual.map((item) =>
        item.id === post.id
          ? {
              ...item,
              likedByViewer: !item.likedByViewer,
              likeCount: item.likeCount + (item.likedByViewer ? -1 : 1),
            }
          : item,
      ),
    );
    void alternarCurtida(post.id).then((resultado) => {
      if (!resultado.ok) show("Não consegui registrar sua curtida.", "ruim");
    });
  };

  const revelar = (id: string) => {
    setRevelados((atual) => new Set(atual).add(id));
  };

  return (
    <div>
      <header
        className="px-5 pb-4"
        style={{ paddingTop: "calc(var(--safe-t) + 1.25rem)" }}
      >
        <p className="eyebrow">Ninguém assiste sozinha</p>
        <h1 className="mt-1.5 text-[1.875rem] leading-tight">
          Plantão da comunidade
        </h1>
      </header>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-4">
        <Chip ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Tudo
        </Chip>
        {TIPOS.map((tipo) => (
          <Chip
            key={tipo.valor}
            ativo={filtro === tipo.valor}
            onClick={() => setFiltro(tipo.valor)}
          >
            {tipo.rotulo}
          </Chip>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <EstadoVazio
          icone={<IconeConversa tamanho={24} />}
          titulo="Nada por aqui ainda"
          descricao="Seja a primeira a comentar. Uma teoria bem armada rende o dia inteiro."
        />
      ) : (
        <ul className="space-y-2.5 px-5">
          {visiveis.map((post) => {
            const escondido =
              post.spoiler && esconderSpoiler && !revelados.has(post.id);
            return (
              <li key={post.id}>
                <Publicacao
                  post={post}
                  escondido={escondido}
                  aoRevelar={() => revelar(post.id)}
                  aoCurtir={() => curtir(post)}
                  autorAtual={viewer}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* Enquanto a pessoa lê, o botão encolhe para o ícone e sai da frente do
          texto; parada a rolagem, ele volta a se apresentar por extenso. */}
      <button
        type="button"
        onClick={() => setCompondo(true)}
        aria-label="Escrever no plantão"
        className={`tap fixed right-5 z-40 flex h-13 items-center gap-2 overflow-hidden rounded-full bg-rose-600 font-bold text-cream-50 shadow-[0_0.75rem_2rem_-0.5rem_var(--color-rose-700)] transition-all duration-300 ${
          compacto ? "w-13 justify-center px-0" : "px-5"
        }`}
        style={{ bottom: "calc(var(--tabbar-h) + var(--safe-b) + 1rem)" }}
      >
        <IconeMais tamanho={19} className="shrink-0" />
        <span
          className={`whitespace-nowrap text-[0.9375rem] transition-all duration-300 ${
            compacto ? "w-0 opacity-0" : "w-auto opacity-100"
          }`}
        >
          Escrever
        </span>
      </button>

      <Compositor
        aberto={compondo}
        aoFechar={() => setCompondo(false)}
        novelas={novelas}
        aoPublicar={(mensagem) => {
          show(mensagem, "bom");
          setCompondo(false);
        }}
      />
    </div>
  );
}

function Publicacao({
  post,
  escondido,
  aoRevelar,
  aoCurtir,
  autorAtual,
}: {
  post: FeedPost;
  escondido: boolean;
  aoRevelar: () => void;
  aoCurtir: () => void;
  autorAtual: { nome: string; avatarSeed: string };
}) {
  const [comentarios, setComentarios] = useState(post.comments);
  const [total, setTotal] = useState(post.commentCount);
  const [texto, setTexto] = useState("");
  const [abertos, setAbertos] = useState(false);
  const [enviando, iniciar] = useTransition();

  const enviar = () => {
    const corpo = texto.trim();
    if (corpo.length < 2) return;
    iniciar(async () => {
      const resultado = await comentar(post.id, corpo);
      if (resultado.ok && resultado.comentario) {
        setComentarios((atual) => [...atual, resultado.comentario]);
        setTotal((atual) => atual + 1);
        setTexto("");
      }
    });
  };

  return (
    <article className="surface-card rounded-card p-4">
      <div className="flex items-center gap-2.5">
        <Avatar nome={post.author.name} seed={post.author.avatarSeed} tamanho={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-semibold text-cream-50">
            {post.author.name}
          </p>
          <p className="truncate text-[0.6875rem] text-cream-600">
            @{post.author.handle} · {formatRelative(post.createdAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-cream-400">
          {ROTULO_TIPO[post.kind]}
        </span>
      </div>

      {post.novela ? (
        <Link
          href={`/novela/${post.novela.slug}`}
          className="tap mt-3 flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] p-2"
        >
          <span
            className="block w-8 shrink-0 overflow-hidden rounded-md"
            style={{ aspectRatio: "2 / 3" }}
          >
            <img
              src={post.novela.posterUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-cream-200">
            {post.novela.title}
          </span>
          {post.rating ? (
            <span className="flex shrink-0 items-center gap-0.5 text-[0.75rem] font-bold text-gold-400">
              <IconeEstrela tamanho={13} />
              {post.rating}
            </span>
          ) : null}
        </Link>
      ) : null}

      <div className="relative mt-3">
        <p
          className={`selectable text-[0.9375rem] leading-relaxed text-cream-200 ${
            escondido ? "select-none blur-[6px]" : ""
          }`}
        >
          {post.body}
        </p>
        {escondido ? (
          <button
            type="button"
            onClick={aoRevelar}
            className="tap absolute inset-0 grid place-items-center"
          >
            <span className="flex items-center gap-1.5 rounded-full border border-gold-400/30 bg-ink-950/85 px-3.5 py-2 text-[0.8125rem] font-semibold text-gold-300">
              <IconeOlho tamanho={15} />
              Contém spoiler — tocar para ler
            </span>
          </button>
        ) : null}
      </div>

      <div className="mt-3.5 flex items-center gap-4">
        <button
          type="button"
          onClick={aoCurtir}
          aria-pressed={post.likedByViewer}
          className={`tap -mx-2 -my-2 flex items-center gap-1.5 px-2 py-2 text-[0.8125rem] font-semibold transition-colors ${
            post.likedByViewer ? "text-rose-400" : "text-cream-400"
          }`}
        >
          <IconeCoracao tamanho={17} preenchido={post.likedByViewer} />
          {post.likeCount}
        </button>
        <button
          type="button"
          onClick={() => setAbertos((v) => !v)}
          aria-expanded={abertos}
          className="tap -mx-2 -my-2 flex items-center gap-1.5 px-2 py-2 text-[0.8125rem] font-semibold text-cream-400"
        >
          <IconeConversa tamanho={17} />
          {total}
        </button>
      </div>

      {abertos ? (
        <div className="mt-3.5 space-y-3 border-t border-white/8 pt-3.5">
          {comentarios.length === 0 ? (
            <p className="text-[0.8125rem] text-cream-600">
              Nenhum comentário ainda. Comece a conversa.
            </p>
          ) : (
            comentarios.map((comentario) => (
              <div key={comentario.id} className="flex gap-2.5">
                <Avatar
                  nome={comentario.author.name}
                  seed={comentario.author.avatarSeed}
                  tamanho={26}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.75rem] font-semibold text-cream-200">
                    {comentario.author.name}
                    <span className="ml-1.5 font-normal text-cream-600">
                      {formatRelative(comentario.createdAt)}
                    </span>
                  </p>
                  <p className="selectable mt-0.5 text-[0.8125rem] leading-relaxed text-cream-400">
                    {comentario.body}
                  </p>
                </div>
              </div>
            ))
          )}

          <div className="flex items-end gap-2 pt-1">
            <Avatar nome={autorAtual.nome} seed={autorAtual.avatarSeed} tamanho={26} />
            <input
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter") enviar();
              }}
              placeholder="Escreva um comentário"
              aria-label="Escreva um comentário"
              maxLength={500}
              enterKeyHint="send"
              className="h-10 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-3 text-[0.875rem] text-cream-50 outline-none placeholder:text-cream-600 focus:border-rose-500/60"
            />
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || texto.trim().length < 2}
              className="tap h-10 rounded-xl bg-rose-600 px-3.5 text-[0.8125rem] font-bold text-cream-50 disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Compositor({
  aberto,
  aoFechar,
  novelas,
  aoPublicar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  novelas: { id: string; title: string; accent: string }[];
  aoPublicar: (mensagem: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["valor"]>("THOUGHT");
  const [novelaId, setNovelaId] = useState<string | null>(null);
  const [spoiler, setSpoiler] = useState(false);
  const [nota, setNota] = useState<number | null>(null);
  const [enviando, iniciar] = useTransition();

  const publicar = () => {
    iniciar(async () => {
      const resultado = await publicarNoFeed({
        body: texto,
        novelaId,
        kind: tipo,
        spoiler,
        rating: tipo === "REVIEW" ? nota : null,
      });
      if (resultado.ok) {
        setTexto("");
        setNota(null);
        setSpoiler(false);
        setNovelaId(null);
        aoPublicar("Publicado no plantão");
      }
    });
  };

  return (
    <Folha aberta={aberto} aoFechar={aoFechar} titulo="Escrever no plantão">
      <div className="pb-2">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-3">
          {TIPOS.map((item) => (
            <Chip
              key={item.valor}
              ativo={tipo === item.valor}
              onClick={() => setTipo(item.valor)}
            >
              {item.rotulo}
            </Chip>
          ))}
        </div>

        <textarea
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          rows={5}
          maxLength={900}
          placeholder={
            tipo === "THEORY"
              ? "Qual é a sua teoria? Aponte a cena, o detalhe, a pista…"
              : tipo === "REVIEW"
                ? "Valeu a maratona? Conte para quem ainda não começou."
                : "O que você achou do episódio de hoje?"
          }
          className="w-full resize-none rounded-2xl border border-white/12 bg-white/[0.04] p-3.5 text-[0.9375rem] leading-relaxed text-cream-50 outline-none placeholder:text-cream-600 focus:border-rose-500/60"
        />
        <p className="mt-1 text-right text-[0.6875rem] text-cream-600">
          {texto.length}/900
        </p>

        <p className="eyebrow mb-2 mt-3">Sobre qual novela?</p>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          <Chip ativo={novelaId === null} onClick={() => setNovelaId(null)}>
            Nenhuma
          </Chip>
          {novelas.map((novela) => (
            <Chip
              key={novela.id}
              ativo={novelaId === novela.id}
              onClick={() => setNovelaId(novela.id)}
            >
              {novela.title}
            </Chip>
          ))}
        </div>

        {tipo === "REVIEW" ? (
          <div className="mt-4">
            <p className="eyebrow mb-2">Sua nota</p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((valor) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setNota(valor)}
                  aria-label={`${valor} de 5`}
                  aria-pressed={nota === valor}
                  className={`tap grid size-11 place-items-center rounded-xl border transition-colors ${
                    (nota ?? 0) >= valor
                      ? "border-gold-400/40 bg-gold-400/15 text-gold-400"
                      : "border-white/12 bg-white/5 text-cream-600"
                  }`}
                >
                  <IconeEstrela tamanho={19} preenchido={(nota ?? 0) >= valor} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <label className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(evento) => setSpoiler(evento.target.checked)}
            className="size-5 accent-rose-500"
          />
          <span className="flex-1">
            <span className="block text-[0.875rem] font-semibold text-cream-50">
              Contém spoiler
            </span>
            <span className="block text-[0.75rem] text-cream-600">
              O texto fica embaçado para quem ainda não viu.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={publicar}
          disabled={enviando || texto.trim().length < 3}
          className="tap mt-5 flex h-13 w-full items-center justify-center rounded-2xl bg-rose-600 text-[0.9375rem] font-bold text-cream-50 disabled:opacity-45"
        >
          {enviando ? "Publicando…" : "Publicar"}
        </button>
      </div>
    </Folha>
  );
}
