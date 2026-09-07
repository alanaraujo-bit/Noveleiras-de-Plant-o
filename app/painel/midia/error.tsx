"use client";

import { useEffect } from "react";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { BotaoPainel } from "@/components/painel/primitivos";

export default function ErroDaMidia({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Falha ao carregar mídia", error);
  }, [error]);

  return (
    <>
      <Cabecalho
        titulo="Mídia indisponível"
        descricao="Não foi possível consultar arquivos e armazenamento agora."
      />
      <Conteudo>
        <section className="painel-cartao px-5 py-10 text-center">
          <h2 className="text-[1rem] font-semibold text-[var(--p-texto)]">
            A leitura da mídia falhou
          </h2>
          <p className="mx-auto mt-2 max-w-[56ch] text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
            Tente consultar novamente. Se a falha continuar, use o identificador
            abaixo para localizar o mesmo incidente nos logs da aplicação.
          </p>
          {error.digest ? (
            <p className="tabular mx-auto mt-3 max-w-max rounded-md bg-[var(--p-elevado)] px-2 py-1 text-[0.6875rem] text-[var(--p-suave)]">
              incidente {error.digest}
            </p>
          ) : null}
          <div className="mt-5">
            <BotaoPainel variante="principal" onClick={retry}>
              Tentar novamente
            </BotaoPainel>
          </div>
        </section>
      </Conteudo>
    </>
  );
}
