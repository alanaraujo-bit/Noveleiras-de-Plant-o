import Link from "next/link";
import type { ReactNode } from "react";

import {
  Bloco,
  LinhaRazao,
  NotaDeCobertura,
  Razao,
  Selo,
  Tabela,
  Td,
  Th,
  Vazio,
} from "@/components/painel/primitivos";
import {
  CARMIM,
  GraficoArea,
  Legenda,
  NEUTRO,
  SERIES,
} from "@/components/painel/graficos";
import { IconeSetaDireita, IconeStreaming } from "@/components/painel/icones";
import {
  fmtCompacto,
  fmtDuracao,
  fmtNumero,
  fmtPercentual,
} from "@/lib/painel/numeros";
import type {
  LinhaStreaming,
  ResumoStreaming,
} from "@/lib/painel/metricas/streaming";

export function ResumoDoStreaming({
  resumo,
  periodoRotulo,
}: {
  resumo: ResumoStreaming;
  periodoRotulo: string;
}) {
  return (
    <>
      <section className="painel-cartao flex flex-wrap items-center gap-x-7 gap-y-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span
              className={`painel-pulso absolute inline-flex h-full w-full rounded-full ${
                resumo.assistindoAgora > 0
                  ? "bg-[var(--p-bom)]"
                  : "bg-[var(--p-fraco)]"
              }`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                resumo.assistindoAgora > 0
                  ? "bg-[var(--p-bom)]"
                  : "bg-[var(--p-fraco)]"
              }`}
            />
          </span>
          <span className="text-[0.75rem] font-medium text-[var(--p-suave)]">
            Agora
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <strong className="numero text-[1.75rem] font-semibold text-[var(--p-texto)]">
            {fmtNumero(resumo.assistindoAgora)}
          </strong>
          <span className="text-[0.75rem] text-[var(--p-fraco)]">
            {resumo.assistindoAgora === 1 ? "pessoa assistindo" : "pessoas assistindo"}
          </span>
        </div>
        <p className="ml-auto max-w-[23rem] text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
          Presença inferida por progresso enviado nos últimos 5 minutos. Não é
          uma conexão aberta no servidor de mídia.
        </p>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
        <Bloco
          titulo="Ritmo de reprodução"
          descricao="Plays e conclusões registrados ao longo do recorte"
          acao={
            <Legenda
              itens={[
                { nome: periodoRotulo, cor: CARMIM },
                { nome: "Período anterior", cor: NEUTRO, tracejado: true },
                { nome: "Conclusões", cor: SERIES[2] },
              ]}
            />
          }
        >
          <GraficoArea
            altura={250}
            formato="compacto"
            rotuloEixo="Eventos"
            vazio="Ninguém iniciou uma reprodução neste recorte"
            series={[
              {
                nome: periodoRotulo,
                pontos: resumo.series.reproducoes,
                cor: CARMIM,
              },
              {
                nome: "Período anterior",
                pontos: resumo.series.reproducoesAnterior,
                fantasma: true,
              },
              { nome: "Conclusões", pontos: resumo.series.conclusoes, cor: SERIES[2] },
            ]}
          />
        </Bloco>

        <Bloco titulo="Qualidade do consumo" descricao={periodoRotulo}>
          <Razao>
            <LinhaRazao
              rotulo="Reproduções"
              valor={fmtNumero(resumo.reproducoes.valor)}
              indicador={resumo.reproducoes}
              destaque
            />
            <LinhaRazao
              rotulo="Pessoas"
              valor={fmtNumero(resumo.espectadores.valor)}
              indicador={resumo.espectadores}
              nota="conta identificada ou aparelho"
            />
            <LinhaRazao
              rotulo="Tempo assistido"
              valor={fmtDuracao(resumo.tempoAssistidoMs.valor)}
              indicador={resumo.tempoAssistidoMs}
            />
            <LinhaRazao
              rotulo="Taxa de conclusão"
              valor={
                resumo.taxaConclusao === null
                  ? "—"
                  : fmtPercentual(resumo.taxaConclusao)
              }
              nota={`${fmtNumero(resumo.conclusoes.valor)} conclusões ÷ ${fmtNumero(resumo.reproducoes.valor)} plays`}
            />
            <LinhaRazao
              rotulo="Abandono conhecido"
              valor={
                resumo.taxaAbandono === null
                  ? "—"
                  : fmtPercentual(resumo.taxaAbandono)
              }
              sentido="menor-melhor"
              nota="progresso mais recente marcado como abandono"
            />
            <LinhaRazao
              rotulo="Erros por play"
              valor={resumo.taxaErro === null ? "—" : fmtPercentual(resumo.taxaErro)}
              sentido="menor-melhor"
              nota={`${fmtNumero(resumo.erros.valor)} erros registrados`}
            />
          </Razao>
          {resumo.coberturaTempo.parcial || !resumo.coberturaTempo.desde ? (
            <div className="mt-3 border-t border-[var(--p-linha)] pt-3">
              <NotaDeCobertura
                desde={resumo.coberturaTempo.desde}
                oQue="Tempo assistido"
              />
            </div>
          ) : null}
        </Bloco>
      </div>
    </>
  );
}

export function TabelaDeStreaming({
  titulo,
  descricao,
  linhas,
  hrefDaLinha,
  nomeDaPrimeiraColuna,
  vazio,
  acao,
}: {
  titulo: string;
  descricao: string;
  linhas: LinhaStreaming[];
  hrefDaLinha: (linha: LinhaStreaming) => string;
  nomeDaPrimeiraColuna: string;
  vazio: string;
  acao?: ReactNode;
}) {
  return (
    <section className="painel-cartao overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] px-5 py-4">
        <div>
          <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
            {titulo}
          </h2>
          <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">{descricao}</p>
        </div>
        {acao}
      </header>
      {linhas.length === 0 ? (
        <Vazio
          icone={<IconeStreaming tamanho={28} />}
          titulo={vazio}
          descricao="A tabela nasce dos eventos de reprodução e do progresso real; contadores do catálogo não entram nesta leitura."
        />
      ) : (
        <Tabela
          cabecalho={
            <tr>
              <Th>{nomeDaPrimeiraColuna}</Th>
              <Th alinhar="direita">Plays</Th>
              <Th alinhar="direita">Pessoas</Th>
              <Th alinhar="direita">Assistido</Th>
              <Th alinhar="direita">Conclusão</Th>
              <Th alinhar="direita">Abandonos</Th>
              <Th alinhar="direita">Erros</Th>
              <Th><span className="sr-only">Abrir detalhe</span></Th>
            </tr>
          }
        >
          {linhas.map((linha) => (
            <tr key={linha.id} className="painel-linha">
              <Td>
                <Link href={hrefDaLinha(linha)} className="block max-w-[24rem]">
                  <span className="block truncate font-medium hover:text-[var(--color-rose-300)]">
                    {linha.titulo}
                  </span>
                  {linha.detalhe ? (
                    <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                      {linha.detalhe}
                    </span>
                  ) : null}
                </Link>
              </Td>
              <Td alinhar="direita">{fmtCompacto(linha.reproducoes)}</Td>
              <Td alinhar="direita">{fmtCompacto(linha.espectadores)}</Td>
              <Td alinhar="direita" className="whitespace-nowrap">
                {fmtDuracao(linha.tempoAssistidoMs)}
              </Td>
              <Td alinhar="direita">
                {linha.taxaConclusao === null ? (
                  <span className="text-[var(--p-fraco)]">—</span>
                ) : (
                  <Selo
                    tom={
                      linha.taxaConclusao >= 0.7
                        ? "bom"
                        : linha.taxaConclusao >= 0.4
                          ? "atencao"
                          : "perigo"
                    }
                  >
                    {fmtPercentual(linha.taxaConclusao)}
                  </Selo>
                )}
              </Td>
              <Td alinhar="direita">{fmtCompacto(linha.abandonos)}</Td>
              <Td alinhar="direita">
                {linha.erros > 0 ? (
                  <Selo tom="perigo">{fmtCompacto(linha.erros)}</Selo>
                ) : (
                  <span className="text-[var(--p-fraco)]">0</span>
                )}
              </Td>
              <Td alinhar="direita">
                <Link
                  href={hrefDaLinha(linha)}
                  aria-label={`Abrir detalhe de ${linha.titulo}`}
                  className="inline-flex text-[var(--p-fraco)] hover:text-[var(--p-texto)]"
                >
                  <IconeSetaDireita tamanho={15} />
                </Link>
              </Td>
            </tr>
          ))}
        </Tabela>
      )}
    </section>
  );
}
