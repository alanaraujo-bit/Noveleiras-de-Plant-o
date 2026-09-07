import Link from "next/link";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import {
  BarraDeFiltros,
  CampoDeBusca,
  Paginacao,
  Seletor,
} from "@/components/painel/Filtros";
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
import { CARMIM, GraficoArea } from "@/components/painel/graficos";
import { IconeFinanceiro } from "@/components/painel/icones";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  listarAssinaturas,
  listarPagamentos,
  resumoFinanceiro,
} from "@/lib/painel/metricas/financeiro";
import {
  fmtDataCurta,
  fmtMoeda,
  fmtMoedaCurta,
  fmtNumero,
} from "@/lib/painel/numeros";
import { resolverPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Financeiro" };

type Busca = Promise<Record<string, string | undefined>>;

const ROTULO_DE_STATUS: Record<string, string> = {
  TRIALING: "em teste",
  ACTIVE: "ativa",
  PAST_DUE: "em atraso",
  CANCELED: "cancelada",
  EXPIRED: "expirada",
};

function tomDoStatus(status: string) {
  if (status === "ACTIVE") return "bom" as const;
  if (status === "TRIALING") return "info" as const;
  if (status === "PAST_DUE") return "perigo" as const;
  return "neutro" as const;
}

export default async function PaginaFinanceira({
  searchParams,
}: {
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("financeiro.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });
  const podeAbrirContas = operador.pode("usuarios.ver");

  const [resumo, assinaturas, pagamentos] = await Promise.all([
    resumoFinanceiro(periodo),
    listarAssinaturas({
      termo: params.q,
      plano: params.plano,
      status: params.status,
      pagina: Number(params.pagina ?? 1),
    }),
    listarPagamentos({ periodo, status: params.pagamento, porPagina: 15 }),
  ]);

  const estimando = resumo.cobertura.estimadas > 0;

  return (
    <>
      <Cabecalho
        titulo="Financeiro"
        descricao={`${periodo.rotulo} · ${fmtMoedaCurta(resumo.mrrCents)} de MRR · ${fmtNumero(resumo.assinantesPagantes)} ${resumo.assinantesPagantes === 1 ? "assinatura pagante" : "assinaturas pagantes"}`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        {estimando ? (
          <section className="painel-cartao flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-l-[var(--p-atencao)] px-5 py-3.5">
            <strong className="text-[0.8125rem] font-semibold text-[var(--p-atencao)]">
              {resumo.cobertura.estimadas} de {resumo.cobertura.total}{" "}
              {resumo.cobertura.total === 1 ? "assinatura estimada" : "assinaturas estimadas"}
            </strong>
            <span className="text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
              Elas não têm preço gravado, então o MRR usa o valor de tabela do
              plano. O número vira exato sozinho quando um provedor real
              carimbar o preço em cada cobrança.
            </span>
          </section>
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Bloco titulo="Receita contratada" descricao="Estado das assinaturas agora">
            <Razao>
              <LinhaRazao
                rotulo="MRR"
                valor={fmtMoeda(resumo.mrrCents)}
                nota={estimando ? "inclui valores estimados" : "todo preço gravado"}
                destaque
              />
              <LinhaRazao
                rotulo="ARR"
                valor={fmtMoeda(resumo.arrCents)}
                nota="MRR × 12 — leitura anualizada, não projeção"
              />
              <LinhaRazao
                rotulo="Assinaturas pagantes"
                valor={fmtNumero(resumo.assinantesPagantes)}
                nota="fora do plano gratuito, em status que cobra"
              />
              <LinhaRazao
                rotulo="Ticket médio"
                valor={
                  resumo.ticketMedioCents === null
                    ? "—"
                    : fmtMoeda(resumo.ticketMedioCents)
                }
              />
            </Razao>
          </Bloco>

          <Bloco titulo="Saúde da carteira" descricao="Sinais que pedem ação">
            <Razao>
              <LinhaRazao
                rotulo="Em atraso"
                valor={fmtNumero(resumo.inadimplentes)}
                sentido="menor-melhor"
                nota="cobrança falhou e a assinatura segue ativa"
                destaque
              />
              <LinhaRazao
                rotulo="Em teste"
                valor={fmtNumero(resumo.emTeste)}
                nota="ainda não pagaram nada"
              />
              <LinhaRazao
                rotulo="Cancelamento agendado"
                valor={fmtNumero(resumo.cancelamentoAgendado)}
                sentido="menor-melhor"
                nota="saem no fim do período atual"
              />
              <LinhaRazao
                rotulo="Novas no período"
                valor={fmtNumero(resumo.novasNoPeriodo.valor)}
                indicador={resumo.novasNoPeriodo}
              />
              <LinhaRazao
                rotulo="Canceladas no período"
                valor={fmtNumero(resumo.canceladasNoPeriodo.valor)}
                indicador={resumo.canceladasNoPeriodo}
                sentido="menor-melhor"
              />
            </Razao>
          </Bloco>

          <Bloco titulo="Por plano" descricao="Onde o MRR está concentrado">
            {resumo.porPlano.length === 0 ? (
              <p className="py-8 text-center text-[0.8125rem] text-[var(--p-fraco)]">
                Nenhuma assinatura paga ainda
              </p>
            ) : (
              <ul className="space-y-3">
                {resumo.porPlano.map((plano) => (
                  <li key={plano.plano}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="truncate text-[0.8125rem] text-[var(--p-texto)]">
                        {plano.nome}
                      </span>
                      <span className="tabular shrink-0 text-[0.8125rem] font-semibold text-[var(--p-texto)]">
                        {fmtMoeda(plano.mrrCents)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--p-elevado)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${resumo.mrrCents > 0 ? (plano.mrrCents / resumo.mrrCents) * 100 : 0}%`,
                          background: plano.cor,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[0.6875rem] text-[var(--p-fraco)]">
                      {fmtNumero(plano.assinantes)}{" "}
                      {plano.assinantes === 1 ? "assinante" : "assinantes"}
                      {plano.estimadas > 0
                        ? ` · ${plano.estimadas} ${plano.estimadas === 1 ? "estimada" : "estimadas"} a ${fmtMoeda(plano.precoDeTabelaCents)}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[1fr_21rem]">
          <Bloco
            titulo="Receita realizada"
            descricao="Dinheiro que efetivamente entrou, de Payment — nunca inferido de assinatura"
          >
            <GraficoArea
              altura={220}
              formato="moeda"
              rotuloEixo="Receita"
              vazio="Nenhum pagamento registrado neste recorte"
              series={[
                { nome: "Aprovado", pontos: resumo.receita.serie, cor: CARMIM },
              ]}
            />
          </Bloco>

          <Bloco titulo="Caixa do período" descricao={periodo.rotulo}>
            {!resumo.receita.temRegistro ? (
              <div className="py-4">
                <p className="text-[0.8125rem] leading-relaxed text-[var(--p-suave)]">
                  Nenhum pagamento foi registrado.
                </p>
                <p className="mt-2 text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
                  A tabela existe e está instrumentada, mas nada a alimenta
                  ainda: não há provedor de pagamento conectado. O MRR acima vem
                  das assinaturas contratadas, que é coisa diferente de receita
                  recebida — e por isso os dois números vivem em blocos
                  separados nesta tela.
                </p>
              </div>
            ) : (
              <Razao>
                <LinhaRazao
                  rotulo="Aprovado"
                  valor={fmtMoeda(resumo.receita.aprovadaCents)}
                  nota={`${fmtNumero(resumo.receita.pagamentos)} ${resumo.receita.pagamentos === 1 ? "pagamento" : "pagamentos"}`}
                  destaque
                />
                <LinhaRazao
                  rotulo="Reembolsado"
                  valor={fmtMoeda(resumo.receita.reembolsadaCents)}
                  sentido="menor-melhor"
                />
                <LinhaRazao
                  rotulo="Líquido"
                  valor={fmtMoeda(resumo.receita.liquidaCents)}
                  nota="aprovado menos reembolsos"
                />
                <LinhaRazao
                  rotulo="Falhas"
                  valor={fmtMoeda(resumo.receita.falhasCents)}
                  sentido="menor-melhor"
                  nota={`${fmtNumero(resumo.receita.falhas)} ${resumo.receita.falhas === 1 ? "cobrança falhou" : "cobranças falharam"}`}
                />
                {resumo.receita.demoCents > 0 ? (
                  <LinhaRazao
                    rotulo="De demonstração"
                    valor={fmtMoeda(resumo.receita.demoCents)}
                    sentido="neutro"
                    nota="marcado como isDemo — fora de todos os números acima"
                  />
                ) : null}
              </Razao>
            )}
          </Bloco>
        </div>

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Assinaturas
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              O que está contratado, por pessoa
            </p>
          </header>
          <BarraDeFiltros>
            <CampoDeBusca placeholder="Buscar pessoa…" />
            <Seletor
              chave="plano"
              rotulo="Filtrar por plano"
              opcoes={[
                { valor: "", rotulo: "Todo plano" },
                { valor: "FREE", rotulo: "Gratuito" },
                { valor: "PREMIUM", rotulo: "Premium" },
                { valor: "VIP", rotulo: "VIP" },
              ]}
            />
            <Seletor
              chave="status"
              rotulo="Filtrar por situação"
              opcoes={[
                { valor: "", rotulo: "Toda situação" },
                { valor: "ACTIVE", rotulo: "Ativas" },
                { valor: "TRIALING", rotulo: "Em teste" },
                { valor: "PAST_DUE", rotulo: "Em atraso" },
                { valor: "CANCELED", rotulo: "Canceladas" },
                { valor: "EXPIRED", rotulo: "Expiradas" },
              ]}
            />
          </BarraDeFiltros>
          {assinaturas.linhas.length === 0 ? (
            <Vazio
              icone={<IconeFinanceiro tamanho={28} />}
              titulo={
                params.q || params.plano || params.status
                  ? "Nenhuma assinatura corresponde a este filtro"
                  : "Nenhuma assinatura registrada"
              }
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Pessoa</Th>
                  <Th>Plano</Th>
                  <Th>Situação</Th>
                  <Th alinhar="direita">Preço</Th>
                  <Th alinhar="direita">Início</Th>
                  <Th alinhar="direita">Renova em</Th>
                </tr>
              }
            >
              {assinaturas.linhas.map((assinatura) => (
                <tr key={assinatura.id} className="painel-linha">
                  <Td>
                    {assinatura.usuario ? (
                      <span className="block max-w-[16rem]">
                        {podeAbrirContas ? (
                          <Link
                            href={`/painel/usuarios/${assinatura.usuario.id}`}
                            className="block truncate hover:text-[var(--color-rose-300)]"
                          >
                            {assinatura.usuario.nome}
                          </Link>
                        ) : (
                          <span className="block truncate">
                            {assinatura.usuario.nome}
                          </span>
                        )}
                        <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                          {assinatura.usuario.email}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--p-fraco)]">conta removida</span>
                    )}
                  </Td>
                  <Td>
                    {assinatura.plano === "FREE" ? (
                      <span className="text-[var(--p-fraco)]">gratuito</span>
                    ) : (
                      <Selo tom="acento">{assinatura.plano.toLowerCase()}</Selo>
                    )}
                  </Td>
                  <Td>
                    <Selo tom={tomDoStatus(assinatura.status)}>
                      {ROTULO_DE_STATUS[assinatura.status] ??
                        assinatura.status.toLowerCase()}
                    </Selo>
                    {assinatura.cancelaNoFim ? (
                      <span className="mt-0.5 block text-[0.625rem] text-[var(--p-atencao)]">
                        sai no fim do período
                      </span>
                    ) : null}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {assinatura.plano === "FREE" ? (
                      <span className="text-[var(--p-fraco)]">—</span>
                    ) : (
                      <>
                        {fmtMoeda(assinatura.precoCents)}
                        {assinatura.estimado ? (
                          <span className="ml-1 text-[0.625rem] text-[var(--p-atencao)]">
                            estimado
                          </span>
                        ) : null}
                      </>
                    )}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {fmtDataCurta(assinatura.inicio)}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {assinatura.fimDoPeriodo ? (
                      fmtDataCurta(assinatura.fimDoPeriodo)
                    ) : (
                      <span className="text-[var(--p-fraco)]">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Tabela>
          )}
          <Paginacao
            pagina={assinaturas.pagina}
            paginas={assinaturas.paginas}
            total={assinaturas.total}
            rotuloItem="assinaturas"
          />
        </section>

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              Pagamentos
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              Cada cobrança registrada no período, aprovada ou não
            </p>
          </header>
          {pagamentos.linhas.length === 0 ? (
            <Vazio
              icone={<IconeFinanceiro tamanho={28} />}
              titulo="Nenhum pagamento no período"
              descricao="A tabela Payment está instrumentada e vazia: ainda não há provedor de pagamento conectado. Quando houver, cada cobrança aparece aqui com valor, método e motivo de falha."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Quando</Th>
                  <Th>Pessoa</Th>
                  <Th>Plano</Th>
                  <Th alinhar="direita">Valor</Th>
                  <Th>Situação</Th>
                  <Th>Origem</Th>
                </tr>
              }
            >
              {pagamentos.linhas.map((pagamento) => (
                <tr key={pagamento.id} className="painel-linha">
                  <Td className="whitespace-nowrap">
                    {fmtDataCurta(pagamento.quando)}
                  </Td>
                  <Td>
                    <span className="block max-w-[14rem] truncate">
                      {pagamento.usuario?.nome ?? "conta removida"}
                    </span>
                  </Td>
                  <Td>{pagamento.plano.toLowerCase()}</Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {fmtMoeda(pagamento.valorCents)}
                    {pagamento.reembolsadoCents > 0 ? (
                      <span className="block text-[0.625rem] text-[var(--p-atencao)]">
                        −{fmtMoeda(pagamento.reembolsadoCents)} devolvido
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <Selo
                      tom={
                        pagamento.status === "APPROVED"
                          ? "bom"
                          : pagamento.status === "PENDING"
                            ? "atencao"
                            : "perigo"
                      }
                    >
                      {pagamento.status.toLowerCase()}
                    </Selo>
                    {pagamento.falha ? (
                      <span className="mt-0.5 block max-w-[12rem] truncate text-[0.625rem] text-[var(--p-fraco)]">
                        {pagamento.falha}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-[0.6875rem] text-[var(--p-fraco)]">
                      {pagamento.provedor ?? "—"}
                      {pagamento.metodo ? ` · ${pagamento.metodo}` : ""}
                    </span>
                    {pagamento.demo ? (
                      <Selo tom="neutro">demonstração</Selo>
                    ) : null}
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
