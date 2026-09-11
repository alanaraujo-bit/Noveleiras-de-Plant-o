import { getViewer } from "@/lib/auth/session";
import { BarraAbas } from "@/components/shell/BarraAbas";
import { AplicarPreferencias } from "@/components/sistema/AplicarPreferencias";

/**
 * Casca do aplicativo: barra de abas fixa e espaço reservado para ela.
 * Visitantes exploram o Plantão; cada rota pessoal valida sua própria sessão.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  // O Plantão pode ser explorado antes da conta. As telas que guardam dados
  // pessoais continuam se protegendo na própria rota; aqui só evitamos que a
  // porta de entrada esconda a experiência principal atrás do onboarding.

  return (
    <div className="min-h-[100dvh]">
      <AplicarPreferencias
        reduzirMovimento={viewer?.preferences.reduceMotion ?? false}
        economiaDeDados={viewer?.preferences.dataSaver ?? false}
      />
      <main
        className="mx-auto max-w-lg"
        style={{
          paddingBottom: "calc(var(--tabbar-h) + var(--safe-b) + 1.5rem)",
        }}
      >
        {children}
      </main>
      <BarraAbas />
    </div>
  );
}
