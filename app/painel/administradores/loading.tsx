import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoAdministradores() {
  return (
    <>
      <Cabecalho titulo="Administradores" descricao="Lendo quem alcança o painel…" />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Bloco titulo="Quem alcança" descricao="Contando papéis">
            <Esqueleto linhas={3} />
          </Bloco>
          <Bloco titulo="Como a autoridade funciona" descricao="Vale para toda tela">
            <Esqueleto linhas={4} />
          </Bloco>
          <Bloco titulo="Vocabulário" descricao="Catálogo de permissões">
            <Esqueleto linhas={2} />
          </Bloco>
        </div>
        <Bloco titulo="A equipe" descricao="Resolvendo permissões efetivas">
          <Esqueleto linhas={5} />
        </Bloco>
      </Conteudo>
    </>
  );
}
