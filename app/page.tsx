import { redirect } from "next/navigation";

import { ROTA_INICIAL } from "@/lib/auth/destino";

export default async function RaizPage() {
  redirect(ROTA_INICIAL);
}
