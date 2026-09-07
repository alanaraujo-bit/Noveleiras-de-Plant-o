import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoLogs() {
  return (
    <>
      <Cabecalho titulo="Logs" descricao="Consultando a central de logs…" />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco titulo="O que o sistema registrou" descricao="Agrupando por período">
            <Esqueleto className="h-[13.75rem] w-full" />
          </Bloco>
          <Bloco titulo="Severidade" descricao="Separando por nível">
            <Esqueleto linhas={4} />
          </Bloco>
        </div>
        <Bloco titulo="Registro" descricao="Carregando as linhas">
          <Esqueleto linhas={8} />
        </Bloco>
      </Conteudo>
    </>
  );
}
