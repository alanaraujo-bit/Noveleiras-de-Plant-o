import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { getHistory } from "@/lib/repositories/progresso";
import { BarraProgresso, BotaoLink, EstadoVazio } from "@/components/ui/primitivos";
import { IconeCheck, IconeHistorico, IconeVoltar } from "@/components/ui/icones";
import { formatClock, formatRelative } from "@/lib/format";

export const metadata = { title: "Histórico" };

/** Agrupa por dia para que a lista tenha ritmo de diário, não de tabela. */
function rotuloDoDia(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  const mesmoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mesmoDia(data, hoje)) return "Hoje";
  if (mesmoDia(data, ontem)) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
  }).format(data);
}

export default async function HistoricoPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const historico = await getHistory(viewer.id, 80);

  const grupos = historico.reduce<Record<string, typeof historico>>(
    (acumulado, item) => {
      const chave = rotuloDoDia(item.watchedAt);
      (acumulado[chave] ??= []).push(item);
      return acumulado;
    },
    {},
  );

  return (
    <div>
      <header
        className="flex items-center gap-2 px-4 pb-4"
        style={{ paddingTop: "calc(var(--safe-t) + 1rem)" }}
      >
        <Link
          href="/perfil"
          aria-label="Voltar para o perfil"
          className="tap grid size-10 place-items-center rounded-full text-cream-200 hover:bg-white/8"
        >
          <IconeVoltar tamanho={20} />
        </Link>
        <div>
          <p className="eyebrow">Tudo que você já viu</p>
          <h1 className="text-[1.5rem] leading-tight">Histórico</h1>
        </div>
      </header>

      {historico.length === 0 ? (
        <EstadoVazio
          icone={<IconeHistorico tamanho={24} />}
          titulo="Seu histórico começa no primeiro episódio"
          descricao="Assim que você assistir alguma coisa, ela aparece aqui com a marca de onde parou."
          acao={
            <BotaoLink href="/explorar" variante="secundario">
              Escolher uma novela
            </BotaoLink>
          }
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(grupos).map(([dia, itens]) => (
            <section key={dia}>
              <h2 className="px-5 pb-2 text-[0.75rem] font-bold uppercase tracking-[0.1em] text-cream-600">
                {dia}
              </h2>
              <ul>
                {itens.map((item) => (
                  <li key={item.episodeId}>
                    <Link
                      href={`/assistir/${item.episodeId}`}
                      className="tap flex items-center gap-3.5 px-5 py-2.5"
                    >
                      <div
                        className="relative w-[6.5rem] shrink-0 overflow-hidden rounded-xl border border-white/8"
                        style={{ aspectRatio: "16 / 9" }}
                      >
                        <img
                          src={item.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 size-full object-cover"
                        />
                        {item.completed ? (
                          <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-jade-400 text-ink-950">
                            <IconeCheck tamanho={12} />
                          </span>
                        ) : (
                          <span className="absolute inset-x-1 bottom-1">
                            <BarraProgresso
                              percent={item.percent}
                              cor={item.accent}
                            />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.9375rem] font-semibold leading-snug text-cream-50">
                          {item.episodeTitle}
                        </p>
                        <p className="mt-0.5 truncate text-[0.8125rem] text-cream-400">
                          {item.novelaTitle}
                        </p>
                        <p className="mt-1 text-[0.75rem] text-cream-600">
                          T{item.seasonNumber} · Ep. {item.episodeNumber} ·{" "}
                          {item.completed
                            ? "concluído"
                            : `parou em ${formatClock(item.positionSec)}`}{" "}
                          · {formatRelative(item.watchedAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
