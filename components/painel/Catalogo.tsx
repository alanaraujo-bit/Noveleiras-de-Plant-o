import Link from "next/link";

import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
  Tabela,
  Td,
  Th,
  Vazio,
} from "@/components/painel/primitivos";
import { IconeCatalogo, IconeSetaDireita } from "@/components/painel/icones";
import {
  fmtCompacto,
  fmtDataCurta,
  fmtDuracao,
  fmtNumero,
  fmtRelogio,
} from "@/lib/painel/numeros";
import type {
  Divergencia,
  LinhaDoCatalogo,
  ResumoDoCatalogo,
} from "@/lib/painel/metricas/catalogo";

export const ROTULO_DE_STATUS: Record<string, string> = {
  ONGOING: "em exibição",
  COMPLETED: "concluída",
  COMING_SOON: "em breve",
};

export const ROTULO_DE_TIER: Record<string, string> = {
  FREE: "aberto",
  PREMIUM: "assinantes",
};

export function SeloDeStatus({ status }: { status: string }) {
  return (
    <Selo
      tom={
        status === "ONGOING"
          ? "bom"
          : status === "COMING_SOON"
            ? "atencao"
            : "neutro"
      }
    >
      {ROTULO_DE_STATUS[status] ?? status.toLowerCase()}
    </Selo>
  );
}

export function SeloDeTier({ tier }: { tier: string }) {
  if (tier === "FREE") {
    return <span className="text-[var(--p-fraco)]">aberto</span>;
  }
  return <Selo tom="acento">{ROTULO_DE_TIER[tier] ?? tier.toLowerCase()}</Selo>;
}

export function ResumoDoCatalogoBloco({
  resumo,
  periodoRotulo,
}: {
  resumo: ResumoDoCatalogo;
  periodoRotulo: string;
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
      <Bloco titulo="O que existe" descricao="Estado do catálogo agora, sem recorte de tempo">
        <Razao>
          <LinhaRazao rotulo="Novelas" valor={fmtNumero(resumo.novelas)} destaque />
          <LinhaRazao
            rotulo="Em exibição"
            valor={fmtNumero(resumo.emExibicao)}
            nota={`${fmtNumero(resumo.concluidas)} concluídas · ${fmtNumero(resumo.emBreve)} em breve`}
          />
          <LinhaRazao rotulo="Temporadas" valor={fmtNumero(resumo.temporadas)} />
          <LinhaRazao
            rotulo="Episódios"
            valor={fmtNumero(resumo.episodios)}
            nota={`${fmtNumero(resumo.episodiosBonus)} marcados como bônus`}
          />
          <LinhaRazao rotulo="Gêneros" valor={fmtNumero(resumo.generos)} />
        </Razao>
      </Bloco>

      <Bloco titulo="Quanto dura" descricao="Somatório das durações declaradas nos episódios">
        <Razao>
          <LinhaRazao
            rotulo="Catálogo inteiro"
            valor={fmtDuracao(resumo.duracaoTotalSeg * 1000)}
            destaque
          />
          <LinhaRazao
            rotulo="Episódio médio"
            valor={
              resumo.duracaoMediaSeg === null
                ? "—"
                : fmtRelogio(resumo.duracaoMediaSeg)
            }
            nota="duração declarada, não tempo assistido"
          />
          <LinhaRazao
            rotulo="Episódios pagos"
            valor={fmtNumero(resumo.episodiosPremium)}
            nota={`${fmtNumero(resumo.novelasPremium)} novelas fora do acesso aberto`}
          />
          <LinhaRazao rotulo="Em destaque" valor={fmtNumero(resumo.destaques)} />
        </Razao>
      </Bloco>

      <Bloco titulo="O que entrou" descricao={`Publicações datadas dentro de ${periodoRotulo}`}>
        <Razao>
          <LinhaRazao
            rotulo="Novelas publicadas"
            valor={fmtNumero(resumo.publicadasNoPeriodo)}
            destaque
          />
          <LinhaRazao
            rotulo="Episódios publicados"
            valor={fmtNumero(resumo.episodiosNoPeriodo)}
          />
          <LinhaRazao
            rotulo="Última publicação"
            valor={
              resumo.ultimaPublicacao
                ? fmtDataCurta(resumo.ultimaPublicacao)
                : "—"
            }
            nota="data de estreia declarada no episódio mais recente"
          />
        </Razao>
        <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
          Datas de publicação são editoriais: dizem quando a estreia foi
          marcada, não quando a linha entrou no banco.
        </p>
      </Bloco>
    </div>
  );
}

export function TabelaDeContadores({
  linhas,
  totalDivergentes,
}: {
  linhas: Divergencia[];
  totalDivergentes: number;
}) {
  if (linhas.length === 0) {
    return (
      <Vazio
        titulo="Nenhum contador está mentindo"
        descricao="Todos os contadores denormalizados batem com os fatos registrados. Nada a reconciliar."
      />
    );
  }

  return (
    <>
      <Tabela
        cabecalho={
          <tr>
            <Th>Novela</Th>
            <Th alinhar="direita">viewCount</Th>
            <Th alinhar="direita">Plays reais</Th>
            <Th alinhar="direita">favoriteCount</Th>
            <Th alinhar="direita">Favoritos reais</Th>
            <Th alinhar="direita">watchedMs</Th>
            <Th alinhar="direita">Tempo real</Th>
          </tr>
        }
      >
        {linhas.map((linha) => (
          <tr key={linha.id} className="painel-linha">
            <Td>
              <span className="block max-w-[18rem] truncate font-medium">
                {linha.titulo}
              </span>
            </Td>
            <Td alinhar="direita" className="text-[var(--p-fraco)]">
              {fmtCompacto(linha.viewCount)}
            </Td>
            <Td alinhar="direita">
              <Selo tom={linha.viewCount === linha.reproducoes ? "neutro" : "atencao"}>
                {fmtCompacto(linha.reproducoes)}
              </Selo>
            </Td>
            <Td alinhar="direita" className="text-[var(--p-fraco)]">
              {fmtCompacto(linha.favoriteCount)}
            </Td>
            <Td alinhar="direita">
              <Selo tom={linha.favoriteCount === linha.favoritos ? "neutro" : "atencao"}>
                {fmtCompacto(linha.favoritos)}
              </Selo>
            </Td>
            <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-fraco)]">
              {fmtDuracao(linha.watchedMs)}
            </Td>
            <Td alinhar="direita" className="whitespace-nowrap">
              <Selo tom={linha.watchedMs === linha.tempoReal ? "neutro" : "atencao"}>
                {fmtDuracao(linha.tempoReal)}
              </Selo>
            </Td>
          </tr>
        ))}
      </Tabela>
      <p className="border-t border-[var(--p-linha)] px-5 py-3 text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
        {totalDivergentes === 1
          ? "1 novela tem contador divergente"
          : `${fmtNumero(totalDivergentes)} novelas têm contadores divergentes`}
        {linhas.length < totalDivergentes
          ? ` — as ${linhas.length} maiores aparecem acima.`
          : "."}{" "}
        Nenhum número do painel vem dessas colunas. Para gravá-las a partir dos
        fatos, rode{" "}
        <code className="rounded bg-[var(--p-elevado)] px-1 py-0.5 text-[0.6875rem] text-[var(--p-suave)]">
          npm run painel:reconciliar -- --aplicar
        </code>
        .
      </p>
    </>
  );
}

export function TabelaDoCatalogo({
  linhas,
  hrefDaLinha,
  vazio,
}: {
  linhas: LinhaDoCatalogo[];
  hrefDaLinha: (linha: LinhaDoCatalogo) => string;
  vazio: string;
}) {
  if (linhas.length === 0) {
    return (
      <Vazio
        icone={<IconeCatalogo tamanho={28} />}
        titulo={vazio}
        descricao="A tabela lista o que existe em Novela, Season e Episode; nenhuma linha aqui é derivada de contador."
      />
    );
  }

  return (
    <Tabela
      cabecalho={
        <tr>
          <Th>Novela</Th>
          <Th>Status</Th>
          <Th>Acesso</Th>
          <Th alinhar="direita">Temporadas</Th>
          <Th alinhar="direita">Episódios</Th>
          <Th alinhar="direita">Duração</Th>
          <Th alinhar="direita">Estreia</Th>
          <Th>
            <span className="sr-only">Abrir novela</span>
          </Th>
        </tr>
      }
    >
      {linhas.map((linha) => (
        <tr key={linha.id} className="painel-linha">
          <Td>
            <Link href={hrefDaLinha(linha)} className="block max-w-[22rem]">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium hover:text-[var(--color-rose-300)]">
                  {linha.titulo}
                </span>
                {linha.destaque ? <Selo tom="acento">destaque</Selo> : null}
              </span>
              <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                {linha.slug} · {linha.ano}
              </span>
            </Link>
          </Td>
          <Td>
            <SeloDeStatus status={linha.status} />
          </Td>
          <Td>
            <SeloDeTier tier={linha.tier} />
          </Td>
          <Td alinhar="direita">{fmtNumero(linha.temporadas)}</Td>
          <Td alinhar="direita">{fmtNumero(linha.episodios)}</Td>
          <Td alinhar="direita" className="whitespace-nowrap">
            {fmtDuracao(linha.duracaoSeg * 1000)}
          </Td>
          <Td alinhar="direita" className="whitespace-nowrap">
            {fmtDataCurta(linha.publicadaEm)}
          </Td>
          <Td alinhar="direita">
            <Link
              href={hrefDaLinha(linha)}
              aria-label={`Abrir ${linha.titulo} no catálogo`}
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
