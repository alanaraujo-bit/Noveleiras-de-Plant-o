import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { Bloco, Esqueleto } from "@/components/painel/primitivos";

export default function CarregandoComunidade() {
  return (
    <>
      <Cabecalho
        titulo="Comunidade"
        descricao="Lendo publicações, comentários e denúncias…"
      />
      <Conteudo className="space-y-5" aria-busy="true">
        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco titulo="O que a comunidade publicou" descricao="Consultando publicações por período">
            <Esqueleto className="h-[15.625rem] w-full" />
          </Bloco>
          <Bloco titulo="Conversa e moderação" descricao="Calculando totais">
            <Esqueleto linhas={7} />
          </Bloco>
        </div>
        <Bloco titulo="Esperando decisão" descricao="Montando a fila de moderação">
          <Esqueleto linhas={4} />
        </Bloco>
        <Bloco titulo="Publicações" descricao="Carregando o que foi publicado">
          <Esqueleto linhas={6} />
        </Bloco>
      </Conteudo>
    </>
  );
}
