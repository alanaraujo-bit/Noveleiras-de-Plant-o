import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { Reel } from "@/components/reel/Reel";
import { getViewer } from "@/lib/auth/session";
import { continuacaoDaNovela, filaInicial } from "@/lib/repositories/reel";
import { track } from "@/lib/analytics/track";
import { db } from "@/lib/db";
import { ANONYMOUS_ENTITLEMENT } from "@/lib/access/entitlements";

export const metadata: Metadata = {
  title: "Plantão",
  description: "Novelas verticais, um episódio por vez.",
};

/**
 * A tela com que o aplicativo abre.
 *
 * A fila inteira — vídeo assinado, acesso decidido, curtidas, ponto de
 * retomada — vem pronta com o HTML. É deliberado: qualquer ida à rede antes do
 * primeiro quadro apareceria como um cartaz parado, e um cartaz parado na
 * abertura é a diferença entre "isto é um reel" e "isto é um site de vídeo".
 *
 * A rota não é estática nem cacheável: cada pessoa vê uma fila diferente,
 * montada a partir do que ela já assistiu.
 */
type PlantaoProps = {
  searchParams: Promise<{ episodio?: string | string[] }>;
};

export default async function PlantaoPage({ searchParams }: PlantaoProps) {
  const viewer = await getViewer();

  const episodioParam = (await searchParams).episodio;
  const jar = await cookies();
  const episodioId =
    typeof episodioParam === "string" ? episodioParam : !viewer
      ? jar.get("nvl_visitante_episodio")?.value.slice(0, 200)
      : undefined;
  const episodio = episodioId
    ? await db.episode.findUnique({
        where: { id: episodioId },
        select: { id: true, novelaId: true },
      })
    : null;

  const fila = episodio
    ? {
        laminas: await continuacaoDaNovela({
          novelaId: episodio.novelaId,
          apartirDoEpisodioId: episodio.id,
          incluirAtual: typeof episodioParam === "string" || Boolean(viewer) || jar.get("nvl_visitante_concluido")?.value !== "1",
          viewerId: viewer?.id ?? null,
          entitlement: viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT,
        }),
        retomando: false,
      }
    : await filaInicial({
        viewerId: viewer?.id ?? null,
        entitlement: viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT,
      });

  await track({
    type: "REEL_OPEN",
    userId: viewer?.id ?? null,
    sessionId: viewer?.appSessionId ?? null,
    payload: {
      laminas: fila.laminas.length,
      retomando: fila.retomando,
      origem: episodio ? "catalogo" : "abertura",
    },
  });

  if (fila.laminas.length === 0 && episodio) {
    fila.laminas = (await filaInicial({ viewerId: viewer?.id ?? null, entitlement: viewer?.entitlement ?? ANONYMOUS_ENTITLEMENT })).laminas;
  }
  if (fila.laminas.length === 0) return <CatalogoVazio />;

  return (
    <Reel
      key={`${viewer?.id ?? "visitante"}:${fila.laminas[0].episodio.id}`}
      laminasIniciais={fila.laminas}
      economiaDeDados={viewer?.preferences.dataSaver ?? false}
      viewer={
        viewer
          ? {
              nome: viewer.name,
              avatarSeed: viewer.avatarSeed,
              avatarUrl: viewer.avatarUrl,
            }
          : null
      }
    />
  );
}

/**
 * Nenhuma lâmina montável.
 *
 * Acontece quando o catálogo não tem episódio publicado — em ambiente novo,
 * antes da primeira ingestão. Diz a causa e o próximo passo em vez de mostrar
 * uma tela preta que parece um defeito.
 */
function CatalogoVazio() {
  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center"
      style={{ paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 2rem)" }}
    >
      <p className="eyebrow">Plantão</p>
      <h1 className="mt-2 text-[1.5rem] leading-tight text-balance-pt">
        Ainda não há episódios no ar
      </h1>
      <p className="mt-2.5 max-w-[22rem] text-[0.9375rem] leading-relaxed text-cream-400">
        Assim que o catálogo receber o primeiro episódio, ele abre aqui tocando.
      </p>
      <Link
        href="/explorar"
        className="tap mt-7 inline-flex h-13 items-center justify-center rounded-2xl bg-cream-50 px-7 text-[0.9375rem] font-bold text-ink-950"
      >
        Ver o catálogo
      </Link>
    </div>
  );
}
