import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoFinanceiro() {
  return (
    <>
      <Cabecalho titulo="Financeiro" descricao="Lendo assinaturas e pagamentos…" />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Bloco titulo="Receita contratada" descricao="Somando assinaturas">
            <Esqueleto linhas={4} />
          </Bloco>
          <Bloco titulo="Saúde da carteira" descricao="Separando por situação">
            <Esqueleto linhas={5} />
          </Bloco>
          <Bloco titulo="Por plano" descricao="Distribuindo o MRR">
            <Esqueleto linhas={3} />
          </Bloco>
        </div>
        <Bloco titulo="Assinaturas" descricao="Carregando o que está contratado">
          <Esqueleto linhas={6} />
        </Bloco>
      </Conteudo>
    </>
  );
}
