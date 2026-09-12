import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { listFavorites, getContinueWatching } from "@/lib/repositories/progresso";
import { getPopulares } from "@/lib/repositories/catalog";
import { Capa, TrilhoCapas, TrilhoContinuar } from "@/components/novela/cartoes";
import {
  BotaoLink,
  EstadoVazio,
  TituloSecao,
} from "@/components/ui/primitivos";
import { IconeCoracao } from "@/components/ui/icones";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Minha lista" };

export default async function MinhaListaPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const [favoritos, continuar] = await Promise.all([
    listFavorites(viewer.id),
    getContinueWatching(viewer.id, 8),
  ]);

  return (
    <div>
      <header
        className="px-5 pb-5"
        style={{ paddingTop: "calc(var(--safe-t) + 1.25rem)" }}
      >
        <p className="eyebrow">Guardadas por você</p>
        <h1 className="mt-1.5 text-[1.875rem] leading-tight">Minha lista</h1>
      </header>

      {continuar.length > 0 ? (
        <section className="mb-8">
          <TituloSecao sobretitulo="Em andamento">
            Continuar assistindo
          </TituloSecao>
          <TrilhoContinuar itens={continuar} />
        </section>
      ) : null}

      {favoritos.length === 0 ? (
        <ListaVazia />
      ) : (
        <section>
          <TituloSecao sobretitulo={`${favoritos.length} na lista`}>
            Para assistir
          </TituloSecao>
          <ul className="grid grid-cols-3 gap-2.5 px-5">
            {favoritos.map((item) => (
              <li key={item.novela.id}>
                <Capa novela={item.novela} largura="cheia" />
                <p className="mt-1 px-0.5 text-[0.6875rem] text-cream-600">
                  Salva {formatRelative(item.addedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

async function ListaVazia() {
  const sugestoes = await getPopulares(8);
  return (
    <>
      <EstadoVazio
        icone={<IconeCoracao tamanho={24} />}
        titulo="Sua lista ainda está vazia"
        descricao="Toque no coração em qualquer novela para guardá-la aqui e não perder o fio da história."
        acao={
          <BotaoLink href="/explorar" variante="secundario" tamanho="medio">
            Ver o catálogo
          </BotaoLink>
        }
      />
      <section className="mt-8">
        <TituloSecao sobretitulo="Para dar o primeiro passo">
          Populares agora
        </TituloSecao>
        <TrilhoCapas novelas={sugestoes} />
      </section>
    </>
  );
}
