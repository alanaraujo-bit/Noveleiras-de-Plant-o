import Link from "next/link";
import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import { ResumoDaDescoberta } from "@/components/painel/Descoberta";
import { BarrasRanking } from "@/components/painel/graficos";
import {
  Bloco,
  Migalhas,
  Selo,
  Tabela,
  Td,
  Th,
  Vazio,
} from "@/components/painel/primitivos";
import { IconeBuscaPainel } from "@/components/painel/icones";
import { exigirPermissao } from "@/lib/painel/guarda";
import { detalheDoTermo } from "@/lib/painel/metricas/descoberta";
import { fmtDataHora, fmtNumero } from "@/lib/painel/numeros";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

type Params = Promise<{ termo: string }>;
type Busca = Promise<Record<string, string | undefined>>;

export const metadata = { title: "Termo buscado" };

export default async function PaginaDoTermo({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("busca.ver");

  const { termo } = await params;
  const busca = await searchParams;
  const periodo = resolverPeriodo(busca.periodo, {
    de: busca.de,
    ate: busca.ate,
  });
  const sufixo = sufixoDoPeriodo(busca);

  const detalhe = await detalheDoTermo(termo, periodo);
  if (!detalhe) notFound();

  // Quem não administra contas continua vendo quem buscou; só não ganha um
  // link que terminaria numa tela de permissão negada.
  const podeAbrirContas = operador.pode("usuarios.ver");

  return (
    <>
      <Cabecalho
        titulo={detalhe.exemplo}
        descricao={
          // Um termo pode chegar com 80 caracteres sem espaço; sem quebra
          // forçada ele empurraria o cabeçalho inteiro para fora da tela.
          <span className="break-all">
            {periodo.rotulo} · termo normalizado “{detalhe.termo}”
          </span>
        }
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Descoberta", href: `/painel/descoberta${sufixo}` },
            { rotulo: detalhe.exemplo },
          ]}
        />

        <ResumoDaDescoberta
          resumo={detalhe.resumo}
          periodoRotulo={periodo.rotulo}
        />

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Como escreveram"
            descricao="Grafias distintas que caíram neste mesmo termo normalizado"
          >
            {detalhe.variantes.length === 0 ? (
              <p className="py-8 text-center text-[0.8125rem] text-[var(--p-fraco)]">
                Nenhuma busca por este termo no recorte selecionado
              </p>
            ) : (
              <BarrasRanking
                formato="numero"
                itens={detalhe.variantes.map((variante) => ({
                  chave: variante.term,
                  rotulo: variante.term,
                  valor: variante.buscas,
                  nota: fmtDataHora(variante.ultimaVez),
                }))}
              />
            )}
          </Bloco>

          <Bloco
            titulo="Onde a busca terminou"
            descricao="Novelas abertas a partir deste termo"
          >
            <BarrasRanking
              formato="numero"
              itens={detalhe.destinos}
              vazio="Nenhuma busca por este termo terminou num título aberto"
            />
          </Bloco>
        </div>

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Buscas recentes
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              As 20 últimas ocorrências do termo dentro do recorte, uma linha
              por busca gravada
            </p>
          </header>
          {detalhe.recentes.length === 0 ? (
            <Vazio
              icone={<IconeBuscaPainel tamanho={28} />}
              titulo="Nenhuma busca por este termo no recorte"
              descricao="O termo existe no histórico, mas ninguém o digitou dentro do período selecionado."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Quando</Th>
                  <Th>Escrito como</Th>
                  <Th alinhar="direita">Resultados</Th>
                  <Th>Abriu</Th>
                  <Th>Quem</Th>
                </tr>
              }
            >
              {detalhe.recentes.map((linha) => (
                <tr key={linha.id} className="painel-linha">
                  <Td className="whitespace-nowrap">
                    {fmtDataHora(linha.createdAt)}
                  </Td>
                  <Td>
                    <span className="block max-w-[18rem] break-all">
                      {linha.term}
                    </span>
                  </Td>
                  <Td alinhar="direita">
                    {linha.resultCount === 0 ? (
                      <Selo tom="perigo">0</Selo>
                    ) : (
                      fmtNumero(linha.resultCount)
                    )}
                  </Td>
                  <Td>
                    {linha.novelaClicada ? (
                      <span className="block max-w-[16rem] truncate">
                        {linha.novelaClicada}
                      </span>
                    ) : (
                      <span className="text-[var(--p-fraco)]">—</span>
                    )}
                  </Td>
                  <Td>
                    {linha.quem === null ? (
                      <span className="text-[var(--p-fraco)]">
                        sem conta identificada
                      </span>
                    ) : podeAbrirContas ? (
                      <Link
                        href={`/painel/usuarios/${linha.quem.id}`}
                        className="hover:text-[var(--color-rose-300)]"
                      >
                        @{linha.quem.handle}
                      </Link>
                    ) : (
                      <span>@{linha.quem.handle}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Tabela>
          )}
        </section>
      </Conteudo>
    </>
  );
}
