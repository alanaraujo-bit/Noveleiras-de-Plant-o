import Link from "next/link";

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
import { IconeBuscaPainel, IconeSetaDireita } from "@/components/painel/icones";
import {
  fmtCompacto,
  fmtDataHora,
  fmtNumero,
  fmtPercentual,
} from "@/lib/painel/numeros";
import type {
  LinhaDeTermo,
  ResumoDescoberta,
} from "@/lib/painel/metricas/descoberta";

/** Uma busca vazia é sempre notícia; poucas linhas vazias, nem tanto. */
function tomDaFalha(taxa: number): "bom" | "atencao" | "perigo" {
  if (taxa >= 0.5) return "perigo";
  if (taxa >= 0.2) return "atencao";
  return "bom";
}

export function ResumoDaDescoberta({
  resumo,
  periodoRotulo,
}: {
  resumo: ResumoDescoberta;
  periodoRotulo: string;
}) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
      <Bloco
        titulo="O que procuram"
        descricao="Buscas registradas ao longo do recorte, e quantas voltaram vazias"
        acao={
          <Legenda
            itens={[
              { nome: periodoRotulo, cor: CARMIM },
              { nome: "Período anterior", cor: NEUTRO, tracejado: true },
              { nome: "Sem resultado", cor: SERIES[1] },
            ]}
          />
        }
      >
        <GraficoArea
          altura={250}
          formato="compacto"
          rotuloEixo="Buscas"
          vazio="Ninguém buscou nada neste recorte"
          series={[
            { nome: periodoRotulo, pontos: resumo.series.buscas, cor: CARMIM },
            {
              nome: "Período anterior",
              pontos: resumo.series.buscasAnterior,
              fantasma: true,
            },
            {
              nome: "Sem resultado",
              pontos: resumo.series.semResultado,
              cor: SERIES[1],
            },
          ]}
        />
      </Bloco>

      <Bloco titulo="Saúde da busca" descricao={periodoRotulo}>
        <Razao>
          <LinhaRazao
            rotulo="Buscas"
            valor={fmtNumero(resumo.buscas.valor)}
            indicador={resumo.buscas}
            destaque
          />
          <LinhaRazao
            rotulo="Pessoas"
            valor={fmtNumero(resumo.pessoas.valor)}
            indicador={resumo.pessoas}
            nota="conta identificada ou sessão"
          />
          <LinhaRazao
            rotulo="Termos distintos"
            valor={fmtNumero(resumo.termosDistintos.valor)}
            indicador={resumo.termosDistintos}
            nota="agrupados pela forma normalizada"
          />
          <LinhaRazao
            rotulo="Sem resultado"
            valor={
              resumo.taxaSemResultado === null
                ? "—"
                : fmtPercentual(resumo.taxaSemResultado)
            }
            sentido="menor-melhor"
            nota={`${fmtNumero(resumo.semResultado.valor)} buscas voltaram vazias`}
          />
          <LinhaRazao
            rotulo="Levaram a uma novela"
            valor={
              resumo.taxaClique === null ? "—" : fmtPercentual(resumo.taxaClique)
            }
            nota={`${fmtNumero(resumo.cliques.valor)} buscas terminaram num título aberto`}
          />
          <LinhaRazao
            rotulo="Resultados por busca"
            valor={
              resumo.resultadoMedio === null
                ? "—"
                : resumo.resultadoMedio.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })
            }
            nota="média do que o catálogo devolveu"
          />
        </Razao>
        {resumo.cobertura.parcial || !resumo.cobertura.desde ? (
          <div className="mt-3 border-t border-[var(--p-linha)] pt-3">
            <NotaDeCobertura desde={resumo.cobertura.desde} oQue="Buscas" />
          </div>
        ) : null}
      </Bloco>
    </div>
  );
}

export function TabelaDeTermos({
  linhas,
  hrefDaLinha,
  vazio,
}: {
  linhas: LinhaDeTermo[];
  hrefDaLinha: (linha: LinhaDeTermo) => string;
  vazio: string;
}) {
  if (linhas.length === 0) {
    return (
      <Vazio
        icone={<IconeBuscaPainel tamanho={28} />}
        titulo={vazio}
        descricao="A tabela nasce das buscas gravadas em SearchQuery; nenhum termo é sugerido, agrupado por semelhança ou inventado pelo painel."
      />
    );
  }

  return (
    <Tabela
      cabecalho={
        <tr>
          <Th>Termo</Th>
          <Th alinhar="direita">Buscas</Th>
          <Th alinhar="direita">Pessoas</Th>
          <Th alinhar="direita">Sem resultado</Th>
          <Th alinhar="direita">Levou a um título</Th>
          <Th alinhar="direita">Última vez</Th>
          <Th>
            <span className="sr-only">Abrir detalhe</span>
          </Th>
        </tr>
      }
    >
      {linhas.map((linha) => (
        <tr key={linha.termo} className="painel-linha">
          <Td>
            <Link href={hrefDaLinha(linha)} className="block max-w-[24rem]">
              <span className="block truncate font-medium hover:text-[var(--color-rose-300)]">
                {linha.exemplo}
              </span>
              {linha.exemplo !== linha.termo ? (
                <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                  {linha.termo}
                </span>
              ) : null}
            </Link>
          </Td>
          <Td alinhar="direita">{fmtCompacto(linha.buscas)}</Td>
          <Td alinhar="direita">{fmtCompacto(linha.pessoas)}</Td>
          <Td alinhar="direita">
            {linha.semResultado === 0 ? (
              <span className="text-[var(--p-fraco)]">0</span>
            ) : (
              <Selo tom={tomDaFalha(linha.taxaSemResultado ?? 0)}>
                {fmtCompacto(linha.semResultado)}
                {linha.taxaSemResultado === null
                  ? ""
                  : ` · ${fmtPercentual(linha.taxaSemResultado, 0)}`}
              </Selo>
            )}
          </Td>
          <Td alinhar="direita">
            {linha.taxaClique === null || linha.cliques === 0 ? (
              <span className="text-[var(--p-fraco)]">—</span>
            ) : (
              fmtPercentual(linha.taxaClique, 0)
            )}
          </Td>
          <Td alinhar="direita" className="whitespace-nowrap">
            {fmtDataHora(linha.ultimaVez)}
          </Td>
          <Td alinhar="direita">
            <Link
              href={hrefDaLinha(linha)}
              aria-label={`Abrir detalhe do termo ${linha.exemplo}`}
              className="inline-flex text-[var(--p-fraco)] hover:text-[var(--p-texto)]"
            >
              <IconeSetaDireita tamanho={15} />
            </Link>
          </Td>
        </tr>
      ))}
    </Tabela>
  );
}
