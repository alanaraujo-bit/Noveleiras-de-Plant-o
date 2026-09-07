import { Selo } from "@/components/painel/primitivos";

/**
 * Leitura da trilha de auditoria.
 *
 * Sem "use client": estes são rótulos e marcação estática, e um Server
 * Component que importasse de um módulo de cliente receberia proxies em vez
 * dos valores.
 */

export const ROTULO_DE_SEVERIDADE: Record<string, string> = {
  INFO: "rotina",
  WARNING: "delicada",
  CRITICAL: "crítica",
};

export function SeloDeSeveridade({ severidade }: { severidade: string }) {
  return (
    <Selo
      tom={
        severidade === "CRITICAL"
          ? "perigo"
          : severidade === "WARNING"
            ? "atencao"
            : "neutro"
      }
    >
      {ROTULO_DE_SEVERIDADE[severidade] ?? severidade.toLowerCase()}
    </Selo>
  );
}

function formatar(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (Array.isArray(valor)) {
    return valor.length === 0 ? "(vazio)" : valor.join(", ");
  }
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

/**
 * Antes e depois, campo a campo.
 *
 * `registrarAuditoria` já guarda só o que mudou, então a tela pode mostrar
 * tudo o que recebeu — o par de colunas é o que transforma "alguém editou"
 * em "trocou isto por aquilo".
 */
export function Diferenca({
  antes,
  depois,
}: {
  antes: unknown;
  depois: unknown;
}) {
  const a = (antes ?? {}) as Record<string, unknown>;
  const d = (depois ?? {}) as Record<string, unknown>;
  const chaves = [...new Set([...Object.keys(a), ...Object.keys(d)])];

  if (chaves.length === 0) return null;

  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.75rem] sm:grid-cols-[auto_1fr]">
      {chaves.map((chave) => (
        <div key={chave} className="contents">
          <dt className="text-[var(--p-fraco)]">{chave}</dt>
          <dd className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <span className="break-all text-[var(--p-fraco)] line-through decoration-[var(--p-fraco)]/50">
              {formatar(a[chave])}
            </span>
            <span aria-hidden className="text-[var(--p-fraco)]">
              →
            </span>
            <span className="break-all text-[var(--p-texto)]">
              {formatar(d[chave])}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
