import type { Metadata } from "next";

import { Casca } from "@/components/painel/Casca";
import { db } from "@/lib/db";
import { exigirPainel } from "@/lib/painel/guarda";
import { navegacaoPara } from "@/lib/painel/navegacao";

export const metadata: Metadata = {
  title: { default: "Central de operações", template: "%s · Painel" },
  robots: { index: false, follow: false },
};

/**
 * O painel é sempre renderizado no pedido: mostrar métrica de cache seria
 * mostrar o passado como se fosse o presente.
 */
export const dynamic = "force-dynamic";

export default async function LayoutDoPainel({
  children,
}: {
  children: React.ReactNode;
}) {
  // Primeira barreira real. Quem não é da equipe não passa daqui — e cada
  // página ainda exige a sua própria permissão.
  const operador = await exigirPainel();

  const alertasAbertos = await db.alert.count({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });

  return (
    <Casca
      grupos={navegacaoPara(operador.permissoes)}
      operador={{
        nome: operador.nome,
        email: operador.email,
        papel:
          operador.role === "ADMIN"
            ? "Acesso completo"
            : `${operador.permissoes.length} permissões`,
      }}
      alertasAbertos={alertasAbertos}
    >
      {children}
    </Casca>
  );
}
