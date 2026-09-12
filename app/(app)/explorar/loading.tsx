import { Esqueleto } from "@/components/ui/primitivos";

/**
 * Carregamento do Explorar.
 *
 * Imita a silhueta real — título, campo de busca, filtros e a grade de duas
 * colunas — para que a chegada dos dados não empurre nada de lugar.
 */
export default function CarregandoExplorar() {
  return (
    <div className="animate-fade">
      <div className="px-5" style={{ paddingTop: "calc(var(--safe-t) + 0.875rem)" }}>
        <div className="flex items-center justify-between">
          <Esqueleto className="h-8 w-36" />
          <Esqueleto className="size-9 rounded-full" />
        </div>
        <Esqueleto className="mt-4 h-12 w-full rounded-2xl" />
      </div>

      <div className="flex gap-1.5 overflow-hidden px-5 pb-2.5 pt-[1.375rem]">
        {[5.5, 6.25, 6, 5.75].map((largura, i) => (
          <span
            key={i}
            className="skeleton block h-9 shrink-0 rounded-full"
            style={{ width: `${largura}rem` }}
          />
        ))}
      </div>

      <div className="space-y-2 px-5 pb-4 pt-4">
        <Esqueleto className="h-6 w-48" />
        <Esqueleto className="h-3.5 w-40" />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="skeleton rounded-card" style={{ aspectRatio: "2 / 3" }} />
            <Esqueleto className="mt-2.5 h-4 w-4/5" />
            <Esqueleto className="mt-1.5 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
