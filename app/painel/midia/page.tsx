import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { BarraDeFiltros, Seletor } from "@/components/painel/Filtros";
import { AguardandoInstrumentacao } from "@/components/painel/Instrumentacao";
import { EnfileirarPerfil } from "@/components/painel/InfraAcoes";
import {
  CartaoDeBiblioteca,
  NovaBiblioteca,
} from "@/components/painel/Bibliotecas";
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
  historicoDeVarreduras,
  listarBibliotecas,
} from "@/lib/painel/bibliotecas";
import { db } from "@/lib/db";
import {
  fmtBytes,
  fmtDataHora,
  fmtDesde,
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
  const operador = await exigirPermissao("midia.ver");
  const podeTranscodificar = operador.pode("transcode.gerenciar");
  const podeGerenciar = operador.pode("midia.gerenciar");

  const params = await searchParams;
  const [resumo, arquivos, bibliotecas, varreduras, servidores] =
    await Promise.all([
      resumoDeMidia(),
      listarMidia({ estado: params.estado }),
      listarBibliotecas(),
      historicoDeVarreduras(8),
      db.mediaServer.findMany({
        where: { enabled: true },
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" },
      }),
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
        {/* ------------------------------------------------ bibliotecas */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[1rem] font-semibold text-[var(--p-texto)]">
                Bibliotecas
              </h2>
              <p className="mt-0.5 max-w-[74ch] text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
                Pastas de conteúdo nas máquinas que guardam os vídeos. O painel
                declara e pede a varredura; o agente lê o disco; o servidor
                importa o resultado — nenhum dos três faz o trabalho do outro.
              </p>
            </div>
            <NovaBiblioteca
              servidores={servidores.map((s) => ({
                id: s.id,
                nome: s.name,
                slug: s.slug,
              }))}
              podeGerenciar={podeGerenciar}
            />
          </div>

          {bibliotecas.length === 0 ? (
            <section className="painel-cartao px-6 py-10 text-center">
              <p className="text-[0.9375rem] font-medium text-[var(--p-suave)]">
                Nenhuma biblioteca registrada
              </p>
              <p className="mx-auto mt-2 max-w-[62ch] text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
                Uma biblioteca é uma pasta na máquina que guarda os vídeos.
                Registre a primeira e peça a varredura: o agente lê as pastas,
                mede cada arquivo e o catálogo nasce daí — sem digitar episódio
                por episódio.
              </p>
            </section>
          ) : (
            <div className="space-y-4">
              {bibliotecas.map((biblioteca) => (
                <CartaoDeBiblioteca
                  key={biblioteca.id}
                  biblioteca={biblioteca}
                  podeGerenciar={podeGerenciar}
                />
              ))}
            </div>
          )}

          {varreduras.length > 0 ? (
            <details className="painel-cartao overflow-hidden">
              <summary className="cursor-pointer px-5 py-3.5 text-[0.8125rem] text-[var(--p-suave)] hover:text-[var(--p-texto)]">
                Histórico de varreduras ({varreduras.length})
              </summary>
              <ul className="divide-y divide-[var(--p-linha)] border-t border-[var(--p-linha)]">
                {varreduras.map((varredura) => (
                  <li key={varredura.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <Selo
                        tom={
                          varredura.estado === "DONE"
                            ? "bom"
                            : varredura.estado === "FAILED"
                              ? "perigo"
                              : varredura.estado === "RUNNING"
                                ? "info"
                                : "neutro"
                        }
                      >
                        {varredura.estado.toLowerCase()}
                      </Selo>
                      <span className="text-[0.8125rem] text-[var(--p-texto)]">
                        {varredura.biblioteca}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.75rem] text-[var(--p-fraco)]">
                        {varredura.estado === "DONE"
                          ? `${fmtNumero(varredura.novelasCriadas)} novela(s) nova(s) · ${fmtNumero(varredura.episodiosCriados)} episódio(s) · ${fmtNumero(varredura.arquivos)} arquivo(s) · ${fmtBytes(varredura.bytes)}`
                          : (varredura.etapa ?? "")}
                      </span>
                      <span className="text-[0.75rem] whitespace-nowrap text-[var(--p-fraco)]">
                        {fmtDesde(varredura.pedidaEm)}
                      </span>
                    </div>
                    {varredura.erro ? (
                      <p className="mt-1 rounded bg-[var(--p-elevado)] px-2 py-1 text-[0.6875rem] break-words text-[var(--p-perigo)]">
                        {varredura.erro}
                      </p>
                    ) : null}
                    {varredura.avisos.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {varredura.avisos.slice(0, 4).map((aviso) => (
                          <li
                            key={aviso}
                            className="text-[0.6875rem] text-[var(--p-atencao)]"
                          >
                            {aviso}
                          </li>
                        ))}
                        {varredura.avisos.length > 4 ? (
                          <li className="text-[0.6875rem] text-[var(--p-fraco)]">
                            e mais {varredura.avisos.length - 4}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

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
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] px-5 py-4">
              <div>
                <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                  Arquivos
                </h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
                  Chaves opacas e provedores — nunca URLs
                </p>
              </div>
              {/* Enfileira o que está listado agora: o filtro de estado acima é
                  o que define o lote, e "os 84 arquivos prontos" é uma seleção
                  mais honesta que caixinhas que ninguém marca uma a uma. */}
              <EnfileirarPerfil
                assetIds={arquivos
                  .filter((a) => a.estado !== "MISSING" && a.estado !== "BROKEN")
                  .map((a) => a.id)}
                podeGerenciar={podeTranscodificar}
              />
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
