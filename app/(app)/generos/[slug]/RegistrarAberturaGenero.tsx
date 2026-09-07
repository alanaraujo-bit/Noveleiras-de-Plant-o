"use client";

import { useEffect } from "react";

import { useTelemetry } from "@/components/sistema/TelemetryProvider";

/** Registra que este gênero foi aberto — insumo do painel de categorias. */
export function RegistrarAberturaGenero({
  generoId,
  slug,
}: {
  generoId: string;
  slug: string;
}) {
  const { track } = useTelemetry();

  useEffect(() => {
    track("CATEGORY_OPEN", { entityType: "genero", entityId: generoId, payload: { slug } });
  }, [generoId, slug, track]);

  return null;
}
