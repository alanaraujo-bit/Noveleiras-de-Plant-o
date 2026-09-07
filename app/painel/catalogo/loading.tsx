import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoCatalogo() {
  return (
    <>
      <Cabecalho titulo="Catálogo" descricao="Contando o que existe no catálogo…" />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Bloco titulo="O que existe" descricao="Contando novelas, temporadas e episódios">
            <Esqueleto linhas={5} />
          </Bloco>
          <Bloco titulo="Quanto dura" descricao="Somando durações">
            <Esqueleto linhas={4} />
          </Bloco>
          <Bloco titulo="O que entrou" descricao="Consultando publicações do período">
            <Esqueleto linhas={3} />
          </Bloco>
        </div>
        <Bloco titulo="Contadores contra os fatos" descricao="Comparando colunas com eventos">
          <Esqueleto linhas={4} />
        </Bloco>
        <Bloco titulo="Novelas" descricao="Carregando o catálogo">
          <Esqueleto linhas={6} />
        </Bloco>
      </Conteudo>
    </>
  );
}
