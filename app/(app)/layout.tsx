import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { BarraAbas } from "@/components/shell/BarraAbas";

/**
 * Casca do aplicativo: barra de abas fixa e espaço reservado para ela.
 * Quem não tem conta ou não passou pelo onboarding não chega aqui.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/bem-vindo");
  if (!viewer.onboardedAt) redirect("/bem-vindo");

  return (
    <div className="min-h-[100dvh]">
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
