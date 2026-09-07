import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <div
      className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center px-8 text-center"
      style={{ paddingBottom: "calc(var(--safe-b) + 2rem)" }}
    >
      <p className="eyebrow">Capítulo perdido</p>
      <h1 className="mt-2.5 text-[2rem] leading-tight text-balance-pt">
        Essa página saiu do ar
      </h1>
      <p className="mt-3 max-w-[22rem] text-[0.9375rem] leading-relaxed text-cream-400">
        O endereço não existe mais ou a novela mudou de nome. Volte para a Home
        que a gente te mostra o que está no plantão de hoje.
      </p>
      <Link
        href="/inicio"
        className="tap mt-7 flex h-13 items-center justify-center rounded-2xl bg-rose-600 px-7 text-[0.9375rem] font-bold text-cream-50"
      >
        Ir para o início
      </Link>
    </div>
  );
}
