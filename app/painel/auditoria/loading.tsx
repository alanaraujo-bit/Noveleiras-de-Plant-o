import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoAuditoria() {
  return (
    <>
      <Cabecalho titulo="Auditoria" descricao="Lendo a trilha de ações administrativas…" />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco titulo="O que a equipe fez" descricao="Consultando ações por período">
            <Esqueleto className="h-[13.75rem] w-full" />
          </Bloco>
          <Bloco titulo="Natureza das ações" descricao="Separando por severidade">
            <Esqueleto linhas={5} />
          </Bloco>
        </div>
        <Bloco titulo="Registro" descricao="Carregando antes e depois de cada ação">
          <Esqueleto linhas={6} />
        </Bloco>
      </Conteudo>
    </>
  );
}
