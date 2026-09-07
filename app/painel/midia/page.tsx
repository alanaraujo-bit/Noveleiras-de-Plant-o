import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { BarraDeFiltros, Seletor } from "@/components/painel/Filtros";
import { AguardandoInstrumentacao } from "@/components/painel/Instrumentacao";
import {
  Bloco,
  LinhaRazao,
  Razao,
  Selo,
  Tabela,
  Td,
  Th,
} from "@/components/painel/primitivos";
import { exigirPermissao } from "@/lib/painel/guarda";
import { listarMidia, resumoDeMidia } from "@/lib/painel/metricas/infraestrutura";
import {
  fmtBytes,
  fmtDataHora,
  fmtNumero,
  fmtRelogio,
} from "@/lib/painel/numeros";

export const metadata = { title: "Mídia" };

type Busca = Promise<Record<string, string | undefined>>;

const ROTULO_DE_ESTADO: Record<string, string> = {
  DISCOVERED: "descoberto",
  READY: "pronto",
  PROCESSING: "processando",
  MISSING: "sumiu",
  BROKEN: "quebrado",
  DUPLICATE: "duplicado",
};

function tomDoEstado(estado: string) {
  if (estado === "READY") return "bom" as const;
  if (estado === "MISSING" || estado === "BROKEN") return "perigo" as const;
  if (estado === "PROCESSING" || estado === "DUPLICATE") return "atencao" as const;
  return "neutro" as const;
}

export default async function PaginaDeMidia({
  searchParams,
}: {
  searchParams: Busca;
}) {
  await exigirPermissao("midia.ver");

  const params = await searchParams;
  const [resumo, arquivos] = await Promise.all([
    resumoDeMidia(),
    listarMidia({ estado: params.estado }),
  ]);

  const cobertura =
    resumo.episodiosComChave > 0
      ? (resumo.episodiosComChave - resumo.chavesNaoCatalogadas) /
        resumo.episodiosComChave
      : null;

  return (
    <>
      <Cabecalho
        titulo="Mídia"
        descricao={
          resumo.arquivos === 0
            ? `${fmtNumero(resumo.episodiosComChave)} episódios declaram uma chave · nenhum arquivo catalogado`
            : `${fmtNumero(resumo.arquivos)} arquivos · ${fmtBytes(resumo.tamanhoTotalBytes)}`
        }
      />

      <Conteudo className="space-y-5">
        {/* A distância entre o que o catálogo declara e o que a camada de
            mídia conhece é fato mensurável mesmo com zero arquivos — e é
            exatamente o trabalho que falta. */}
        <Bloco
          titulo="Catálogo contra arquivos"
          descricao="O que os episódios declaram e o que a camada de mídia realmente conhece"
        >
          <Razao>
            <LinhaRazao
              rotulo="Episódios com chave declarada"
              valor={fmtNumero(resumo.episodiosComChave)}
              nota="Episode.mediaKey preenchido no catálogo"
              destaque
            />
            <LinhaRazao
              rotulo="Arquivos catalogados"
              valor={fmtNumero(resumo.arquivos)}
              nota="linhas em MediaAsset"
            />
            <LinhaRazao
              rotulo="Chaves sem arquivo conhecido"
              valor={fmtNumero(resumo.chavesNaoCatalogadas)}
              sentido="menor-melhor"
              nota="o catálogo promete um vídeo que a camada de mídia não viu"
            />
            <LinhaRazao
              rotulo="Cobertura"
              valor={
                cobertura === null
                  ? "—"
                  : `${Math.round(cobertura * 100)}%`
              }
              nota="proporção das chaves declaradas que têm arquivo correspondente"
            />
            {resumo.arquivos > 0 ? (
              <>
                <LinhaRazao
                  rotulo="Arquivos órfãos"
                  valor={fmtNumero(resumo.semEpisodio)}
                  sentido="menor-melhor"
                  nota="existem no disco e nenhum episódio os usa"
                />
                <LinhaRazao
                  rotulo="Duplicados por checksum"
                  valor={fmtNumero(resumo.duplicadasPorChecksum)}
                  sentido="menor-melhor"
                  nota="mesmo conteúdo ocupando espaço mais de uma vez"
                />
              </>
            ) : null}
          </Razao>
        </Bloco>

        {resumo.arquivos === 0 ? (
          <AguardandoInstrumentacao
            oQue="Arquivos, integridade e armazenamento"
            tabela="MediaAsset"
            comoLigar={
              <>
                O catálogo guarda uma chave opaca por episódio e um provedor que
                a resolve em tempo de execução — o painel nunca guarda URL. O
                que falta é o inventário do outro lado: um agente que varra o
                servidor de mídia, calcule checksum e duração, e escreva uma
                linha por arquivo encontrado.
                <br />
                <br />
                Enquanto isso não existe, as{" "}
                {fmtNumero(resumo.chavesNaoCatalogadas)} chaves acima são
                promessas do catálogo que ninguém verificou.
              </>
            }
            oQueVaiMostrar={[
              "Cada arquivo com tamanho, duração, resolução, codec e checksum.",
              "Arquivo que sumiu do disco mas continua prometido pelo catálogo.",
              "Versões do mesmo episódio: original, 1080p, 720p, HLS.",
              "Arquivos órfãos, que ocupam espaço e nenhum episódio usa.",
              "Duplicados detectados por checksum, não por nome.",
            ]}
          />
        ) : (
          <section className="painel-cartao overflow-hidden">
            <header className="border-b border-[var(--p-linha)] px-5 py-4">
              <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                Arquivos
              </h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                Chaves opacas e provedores — nunca URLs
              </p>
            </header>
            <BarraDeFiltros>
              <Seletor
                chave="estado"
                rotulo="Filtrar por estado"
                opcoes={[
                  { valor: "", rotulo: "Todo estado" },
                  ...Object.entries(ROTULO_DE_ESTADO).map(([valor, rotulo]) => ({
                    valor,
                    rotulo,
                  })),
                ]}
              />
            </BarraDeFiltros>
            <Tabela
              cabecalho={
                <tr>
                  <Th>Chave</Th>
                  <Th>Estado</Th>
                  <Th>Episódio</Th>
                  <Th alinhar="direita">Tamanho</Th>
                  <Th alinhar="direita">Duração</Th>
                  <Th alinhar="direita">Verificado</Th>
                </tr>
              }
            >
              {arquivos.map((arquivo) => (
                <tr key={arquivo.id} className="painel-linha">
                  <Td>
                    <span className="block max-w-[20rem]">
                      <span className="block truncate">{arquivo.chave}</span>
                      <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                        {arquivo.provedor.toLowerCase()} · {arquivo.variante}
                        {arquivo.resolucao ? ` · ${arquivo.resolucao}` : ""}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <Selo tom={tomDoEstado(arquivo.estado)}>
                      {ROTULO_DE_ESTADO[arquivo.estado] ?? arquivo.estado}
                    </Selo>
                    {arquivo.nota ? (
                      <span className="mt-0.5 block max-w-[12rem] truncate text-[0.625rem] text-[var(--p-fraco)]">
                        {arquivo.nota}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="block max-w-[14rem] truncate text-[0.75rem]">
                      {arquivo.episodio ?? (
                        <span className="text-[var(--p-atencao)]">órfão</span>
                      )}
                    </span>
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {arquivo.tamanhoBytes === null
                      ? "—"
                      : fmtBytes(arquivo.tamanhoBytes)}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {arquivo.duracaoSeg === null
                      ? "—"
                      : fmtRelogio(arquivo.duracaoSeg)}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {arquivo.ultimaVerificacao
                      ? fmtDataHora(arquivo.ultimaVerificacao)
                      : "nunca"}
                  </Td>
                </tr>
              ))}
            </Tabela>
          </section>
        )}
      </Conteudo>
    </>
  );
}
