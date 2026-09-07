import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { listGenres } from "@/lib/repositories/catalog";
import { PainelPreferencias } from "./PainelPreferencias";
import { IconeVoltar } from "@/components/ui/icones";

export const metadata = { title: "Preferências" };

export default async function PreferenciasPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");

  const generos = await listGenres();

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
          <p className="eyebrow">Do seu jeito</p>
          <h1 className="text-[1.5rem] leading-tight">Preferências</h1>
        </div>
      </header>

      <PainelPreferencias
        inicial={viewer.preferences}
        perfil={{ nome: viewer.name, avatarSeed: viewer.avatarSeed }}
        generos={generos.map((genero) => ({
          id: genero.id,
          name: genero.name,
          accent: genero.accent,
        }))}
      />
    </div>
  );
}
