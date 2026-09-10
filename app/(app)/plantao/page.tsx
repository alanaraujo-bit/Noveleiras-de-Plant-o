import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Reel } from "@/components/reel/Reel";
import { getViewer } from "@/lib/auth/session";
import { filaInicial } from "@/lib/repositories/reel";
import { track } from "@/lib/analytics/track";

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
 * montada a partir do que ela já assistiu e dos gêneros que escolheu.
 */
export default async function PlantaoPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/bem-vindo");

  const { laminas, retomando } = await filaInicial({
    viewerId: viewer.id,
    entitlement: viewer.entitlement,
    generosPreferidos: viewer.preferences.favoriteGenreIds,
  });

  await track({
    type: "REEL_OPEN",
    userId: viewer.id,
    sessionId: viewer.appSessionId,
    payload: { laminas: laminas.length, retomando },
  });

  if (laminas.length === 0) return <CatalogoVazio />;

  return (
    <Reel
      laminasIniciais={laminas}
      economiaDeDados={viewer.preferences.dataSaver}
      temConta
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
        href="/inicio"
        className="tap mt-7 inline-flex h-13 items-center justify-center rounded-2xl bg-cream-50 px-7 text-[0.9375rem] font-bold text-ink-950"
      >
        Ver o catálogo
      </Link>
    </div>
  );
}
