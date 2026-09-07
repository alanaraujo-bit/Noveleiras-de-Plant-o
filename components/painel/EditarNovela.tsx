"use client";

import { useState, useTransition } from "react";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { BotaoPainel } from "@/components/painel/primitivos";
import {
  aplicarAcessoEmLote,
  editarNovela,
} from "@/lib/painel/acoes/catalogo";

/**
 * Edição de uma novela.
 *
 * A outra metade da importação: ela cria a estrutura e se recusa a inventar
 * texto, este formulário é onde quem sabe escreve. Os campos que a importação
 * deixou vazios aparecem marcados, porque uma sinopse em branco não é um
 * detalhe — é o que o público lê antes de decidir assistir.
 */

type Genero = { id: string; nome: string };

const STATUS = [
  { valor: "ONGOING" as const, rotulo: "Em exibição" },
  { valor: "COMPLETED" as const, rotulo: "Concluída" },
  { valor: "COMING_SOON" as const, rotulo: "Em breve" },
];

function Campo({
  rotulo,
  nota,
  vazio,
  children,
}: {
  rotulo: string;
  nota?: string;
  vazio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
        {rotulo}
        {vazio ? (
          <span className="rounded bg-[var(--p-atencao-fundo)] px-1.5 py-0.5 text-[0.5625rem] normal-case text-[var(--p-atencao)]">
            em branco
          </span>
        ) : null}
      </span>
      {children}
      {nota ? (
        <span className="mt-1 block text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
          {nota}
        </span>
      ) : null}
    </label>
  );
}

const entrada =
  "mt-1 h-8 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 text-[0.8125rem] text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none";

export function FormularioDaNovela({
  novela,
  generos,
  podeEditar,
  podePublicar,
}: {
  novela: {
    id: string;
    titulo: string;
    tagline: string;
    sinopse: string;
    ano: number;
    classificacao: string;
    status: string;
    acesso: string;
    destaque: boolean;
    tags: string[];
    generosSelecionados: string[];
    episodios: number;
  };
  generos: Genero[];
  podeEditar: boolean;
  podePublicar: boolean;
}) {
  const [titulo, setTitulo] = useState(novela.titulo);
  const [tagline, setTagline] = useState(novela.tagline);
  const [sinopse, setSinopse] = useState(novela.sinopse);
  const [ano, setAno] = useState(String(novela.ano));
  const [classificacao, setClassificacao] = useState(novela.classificacao);
  const [status, setStatus] = useState(novela.status);
  const [destaque, setDestaque] = useState(novela.destaque);
  const [tags, setTags] = useState(novela.tags.join(", "));
  const [selecionados, setSelecionados] = useState<Set<string>>(
    new Set(novela.generosSelecionados),
  );
  const [resposta, setResposta] = useState<
    { ok: true; mensagem: string } | { ok: false; erro: string } | null
  >(null);
  const [pendente, iniciar] = useTransition();

  if (!podeEditar) return null;

  const alternar = (id: string) =>
    setSelecionados((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });

  const salvar = () =>
    iniciar(async () =>
      setResposta(
        await editarNovela({
          novelaId: novela.id,
          titulo: titulo.trim(),
          tagline: tagline.trim(),
          sinopse: sinopse.trim(),
          ano: Number(ano) || novela.ano,
          classificacao: classificacao.trim() || "14",
          status: status as "ONGOING" | "COMPLETED" | "COMING_SOON",
          destaque,
          generos: [...selecionados],
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      ),
    );

  const faltando = [
    tagline.trim().length === 0 && "chamada",
    sinopse.trim().length === 0 && "sinopse",
    selecionados.size === 0 && "gênero",
  ].filter(Boolean) as string[];

  return (
    <section className="painel-cartao overflow-hidden">
      <header className="border-b border-[var(--p-linha)] px-5 py-4">
        <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
          Ficha editorial
        </h2>
        <p className="mt-0.5 max-w-[74ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
          {faltando.length > 0
            ? `Falta ${faltando.join(", ")}. A importação não inventa texto: ela cria a estrutura e deixa em branco o que só quem conhece a história sabe escrever.`
            : "Tudo preenchido. Este é o texto que o público lê antes de decidir assistir."}
        </p>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Título">
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className={entrada}
            />
          </Campo>
          <Campo
            rotulo="Chamada"
            vazio={tagline.trim().length === 0}
            nota="Uma linha, aparece sob o título na capa"
          >
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Ela voltou. E lembra de tudo."
              className={entrada}
            />
          </Campo>
        </div>

        <Campo
          rotulo="Sinopse"
          vazio={sinopse.trim().length === 0}
          nota="O que o público lê na página da novela"
        >
          <textarea
            value={sinopse}
            onChange={(e) => setSinopse(e.target.value)}
            rows={4}
            placeholder="Conte a premissa sem entregar o final."
            className="mt-1 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 py-2 text-[0.8125rem] leading-relaxed text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none"
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Ano">
            <input
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              inputMode="numeric"
              className={entrada}
            />
          </Campo>
          <Campo rotulo="Classificação" nota="14, 16, 18…">
            <input
              value={classificacao}
              onChange={(e) => setClassificacao(e.target.value)}
              className={entrada}
            />
          </Campo>
          <Campo rotulo="Situação">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={entrada}
            >
              {STATUS.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <fieldset>
          <legend className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
            Gêneros
            {selecionados.size === 0 ? (
              <span className="rounded bg-[var(--p-atencao-fundo)] px-1.5 py-0.5 text-[0.5625rem] normal-case text-[var(--p-atencao)]">
                nenhum
              </span>
            ) : null}
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {generos.map((genero) => {
              const marcado = selecionados.has(genero.id);
              return (
                <button
                  key={genero.id}
                  type="button"
                  onClick={() => alternar(genero.id)}
                  aria-pressed={marcado}
                  className={`h-7 rounded-md border px-2.5 text-[0.75rem] transition-colors ${
                    marcado
                      ? "border-[var(--color-rose-500)]/40 bg-[var(--p-acento-suave)] text-[var(--p-texto)]"
                      : "border-[var(--p-linha)] text-[var(--p-fraco)] hover:text-[var(--p-suave)]"
                  }`}
                >
                  {genero.nome}
                </button>
              );
            })}
          </div>
          <span className="mt-1.5 block text-[0.6875rem] text-[var(--p-fraco)]">
            Sem gênero, a novela não aparece em nenhuma categoria do aplicativo.
          </span>
        </fieldset>

        <Campo rotulo="Tags" nota="Separadas por vírgula; entram na busca">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="vingança, herança, reencontro"
            className={entrada}
          />
        </Campo>

        <label className="flex cursor-pointer items-start gap-2 text-[0.8125rem] text-[var(--p-suave)]">
          <input
            type="checkbox"
            checked={destaque}
            onChange={() => setDestaque((v) => !v)}
            className="mt-0.5 accent-[var(--color-rose-600)]"
          />
          <span>
            Destacar na home
            <span className="block text-[0.6875rem] text-[var(--p-fraco)]">
              Aparece na faixa principal do aplicativo.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--p-linha)] pt-3">
          <BotaoPainel variante="principal" disabled={pendente} onClick={salvar}>
            {pendente ? "Salvando…" : "Salvar ficha"}
          </BotaoPainel>

          {podePublicar ? (
            <>
              <AcaoProtegida
                rotulo="Tornar premium"
                titulo="Cobrar por esta novela?"
                descricao={`Os ${novela.episodios} episódios passam a exigir assinatura, com os dois primeiros abertos para quem quiser experimentar a história.`}
                confirmar="Aplicar"
                variante="sutil"
                acao={async () =>
                  aplicarAcessoEmLote({
                    novelaId: novela.id,
                    acesso: "PREMIUM",
                    gratuitosAteEpisodio: 2,
                  })
                }
              />
              <AcaoProtegida
                rotulo="Abrir para todos"
                titulo="Liberar esta novela?"
                descricao={`Os ${novela.episodios} episódios ficam acessíveis sem assinatura.`}
                confirmar="Abrir"
                variante="fantasma"
                acao={async () =>
                  aplicarAcessoEmLote({ novelaId: novela.id, acesso: "FREE" })
                }
              />
            </>
          ) : null}

          {resposta ? (
            <span
              role="status"
              className={`text-[0.75rem] ${resposta.ok ? "text-[var(--p-bom)]" : "text-[var(--p-perigo)]"}`}
            >
              {resposta.ok ? resposta.mensagem : resposta.erro}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
