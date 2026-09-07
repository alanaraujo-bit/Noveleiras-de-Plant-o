import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoDescoberta() {
  return (
    <>
      <Cabecalho
        titulo="Descoberta"
        descricao="Lendo as buscas gravadas neste recorte…"
      />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco titulo="O que procuram" descricao="Consultando buscas por período">
            <Esqueleto className="h-[15.625rem] w-full" />
          </Bloco>
          <Bloco titulo="Saúde da busca" descricao="Calculando taxas">
            <Esqueleto linhas={6} />
          </Bloco>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco titulo="Procuraram e não acharam" descricao="Separando buscas vazias">
            <Esqueleto linhas={5} />
          </Bloco>
          <Bloco titulo="Para onde a busca leva" descricao="Resolvendo títulos">
            <Esqueleto linhas={5} />
          </Bloco>
        </div>
        <Bloco titulo="Termos buscados" descricao="Agrupando pela forma normalizada">
          <Esqueleto linhas={5} />
        </Bloco>
      </Conteudo>
    </>
  );
}
