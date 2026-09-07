import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoStreaming() {
  return (
    <>
      <Cabecalho
        titulo="Streaming"
        descricao="Carregando os fatos de reprodução deste recorte…"
      />
      <Conteudo className="space-y-5" aria-busy="true">
        <section className="painel-cartao flex items-center gap-5 px-5 py-4">
          <Esqueleto className="h-3 w-16" />
          <Esqueleto className="h-7 w-40" />
        </section>
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco titulo="Ritmo de reprodução" descricao="Consultando eventos por período">
            <Esqueleto className="h-[15.625rem] w-full" />
          </Bloco>
          <Bloco titulo="Qualidade do consumo" descricao="Calculando taxas">
            <Esqueleto linhas={6} />
          </Bloco>
        </div>
        <Bloco titulo="Conteúdo" descricao="Resolvendo títulos e níveis do catálogo">
          <Esqueleto linhas={5} />
        </Bloco>
      </Conteudo>
    </>
  );
}
