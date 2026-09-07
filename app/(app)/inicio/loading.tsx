import { Esqueleto } from "@/components/ui/primitivos";

/**
 * Carregamento da Home.
 *
 * O esqueleto imita a silhueta real da tela (destaque grande, dois trilhos),
 * para que a transição não empurre o conteúdo quando os dados chegam.
 */
export default function CarregandoInicio() {
  return (
    <div className="animate-fade">
      <div className="flex items-center gap-3 px-5 py-3" style={{ paddingTop: "calc(var(--safe-t) + 0.75rem)" }}>
        <Esqueleto className="size-7 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Esqueleto className="h-3.5 w-40" />
          <Esqueleto className="h-2.5 w-24" />
        </div>
        <Esqueleto className="size-9 rounded-full" />
      </div>

      <div className="px-5 pt-1">
        <div
          className="skeleton block rounded-panel"
          style={{ aspectRatio: "4 / 5" }}
        />
      </div>

      {[0, 1].map((secao) => (
        <div key={secao} className="mt-8">
          <div className="space-y-2 px-5">
            <Esqueleto className="h-2.5 w-28" />
            <Esqueleto className="h-6 w-52" />
          </div>
          <div className="mt-3.5 flex gap-3 overflow-hidden px-5">
            {[0, 1, 2].map((cartao) => (
              <div
                key={cartao}
                className="skeleton w-[8.75rem] shrink-0 rounded-card"
                style={{ aspectRatio: "2 / 3" }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
