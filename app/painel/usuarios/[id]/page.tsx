import Link from "next/link";
import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
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
import { rotuloDeDispositivo } from "@/lib/analytics/dispositivo";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  fmtDataHora,
  fmtDesde,
  fmtDuracao,
  fmtMoeda,
  fmtNumero,
  fmtRelogio,
} from "@/lib/painel/numeros";
import { fichaDeUsuario } from "@/lib/painel/metricas/usuario";
import { PLANOS } from "@/lib/painel/planos";
import { AcoesDaConta } from "./AcoesDaConta";

export const metadata = { title: "Ficha da conta" };

const ROTULO_STATUS_ASSINATURA: Record<string, string> = {
  ACTIVE: "Ativa",
  TRIALING: "Em teste",
  PAST_DUE: "Em atraso",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

export default async function FichaDaConta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const operador = await exigirPermissao("usuarios.ver");
  const { id } = await params;

  const ficha = await fichaDeUsuario(id);
  if (!ficha) notFound();

  const { usuario } = ficha;
  const assinatura = usuario.subscription;

  return (
    <>
      <Cabecalho
        titulo={usuario.name}
        voltar={{ href: "/painel/usuarios", rotulo: "Usuários" }}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <span className="selectable">{usuario.email}</span>
            <span className="text-[var(--p-fraco)]">·</span>
            <span className="selectable text-[var(--p-fraco)]">@{usuario.handle}</span>
            {usuario.isDemo ? <Selo>conta de demonstração</Selo> : null}
            {usuario.status === "SUSPENDED" ? (
              <Selo tom="perigo">suspensa</Selo>
            ) : null}
            {usuario.role !== "USER" ? (
              <Selo tom="acento">
                {usuario.role === "ADMIN" ? "administrador" : "editor"}
              </Selo>
            ) : null}
          </span>
        }
      />

      <Conteudo className="space-y-5">
        <div className="grid items-start gap-5 lg:grid-cols-3">
          {/* ---------------------------------------------------------- conta */}
          <Bloco titulo="Conta">
            <Razao>
              <LinhaRazao
                rotulo="Entrou na plataforma"
                valor={fmtDataHora(usuario.createdAt)}
              />
              <LinhaRazao
                rotulo="Último acesso"
                valor={fmtDesde(usuario.lastSeenAt)}
                nota={
                  usuario.lastSeenAt ? fmtDataHora(usuario.lastSeenAt) : undefined
                }
              />
              <LinhaRazao
                rotulo="Concluiu a apresentação"
                valor={usuario.onboardedAt ? "Sim" : "Não"}
                nota={
                  usuario.onboardedAt
                    ? fmtDataHora(usuario.onboardedAt)
                    : "parou antes de escolher os gêneros"
                }
              />
              <LinhaRazao rotulo="Identificador" valor={usuario.id} />
            </Razao>
          </Bloco>

          {/* ----------------------------------------------------- assinatura */}
          <Bloco titulo="Assinatura">
            {assinatura ? (
              <Razao>
                <LinhaRazao
                  rotulo="Plano"
                  valor={PLANOS[assinatura.plan].nome}
                  destaque
                />
                <LinhaRazao
                  rotulo="Situação"
                  valor={
                    ROTULO_STATUS_ASSINATURA[assinatura.status] ??
                    assinatura.status
                  }
                />
                <LinhaRazao
                  rotulo="Valor mensal"
                  valor={
                    assinatura.priceCents != null
                      ? fmtMoeda(assinatura.priceCents)
                      : fmtMoeda(PLANOS[assinatura.plan].precoCents)
                  }
                  nota={
                    assinatura.priceCents == null
                      ? "preço não registrado — valor de tabela do plano"
                      : undefined
                  }
                />
                <LinhaRazao
                  rotulo="Começou em"
                  valor={fmtDataHora(assinatura.startedAt)}
                />
                <LinhaRazao
                  rotulo="Período atual até"
                  valor={fmtDataHora(assinatura.currentPeriodEnd)}
                />
                {assinatura.canceledAt ? (
                  <LinhaRazao
                    rotulo="Cancelada em"
                    valor={fmtDataHora(assinatura.canceledAt)}
                  />
                ) : null}
                <LinhaRazao
                  rotulo="Provedor"
                  valor={assinatura.provider ?? "—"}
                />
              </Razao>
            ) : (
              <Vazio
                titulo="Sem registro de assinatura"
                descricao="A conta nunca teve uma linha de assinatura criada — nem sequer no plano gratuito."
              />
            )}
          </Bloco>

          {/* -------------------------------------------------------- consumo */}
          <Bloco titulo="Consumo">
            <Razao>
              <LinhaRazao
                rotulo="Tempo assistido"
                valor={fmtDuracao(ficha.resumoProgresso.assistidoMs)}
                destaque
              />
              <LinhaRazao
                rotulo="Episódios iniciados"
                valor={fmtNumero(ficha.resumoProgresso.episodios)}
              />
              <LinhaRazao
                rotulo="Episódios concluídos"
                valor={fmtNumero(ficha.resumoProgresso.concluidos)}
                nota={
                  ficha.resumoProgresso.episodios > 0
                    ? `${Math.round((ficha.resumoProgresso.concluidos / ficha.resumoProgresso.episodios) * 100)}% do que começou`
                    : undefined
                }
              />
              <LinhaRazao
                rotulo="Sessões"
                valor={fmtNumero(ficha.resumoSessoes.total)}
              />
              <LinhaRazao
                rotulo="Tempo na plataforma"
                valor={fmtDuracao(ficha.resumoSessoes.tempoTotalMs)}
              />
              <LinhaRazao
                rotulo="Sessão média"
                valor={fmtDuracao(ficha.resumoSessoes.tempoMedioMs)}
              />
              <LinhaRazao
                rotulo="Telas vistas"
                valor={fmtNumero(ficha.resumoSessoes.telas)}
              />
            </Razao>
          </Bloco>
        </div>

        {/* ------------------------------------------------------------- ações */}
        <Bloco
          titulo="Ações administrativas"
          descricao="Tudo aqui fica registrado na auditoria, com quem fez e o motivo"
        >
          <AcoesDaConta
            userId={usuario.id}
            nome={usuario.name}
            suspensa={usuario.status === "SUSPENDED"}
            podeEditar={operador.pode("usuarios.editar")}
            podeMexerNoFinanceiro={operador.pode("financeiro.gerenciar")}
            planoAtual={assinatura?.plan ?? "FREE"}
            statusAtual={assinatura?.status ?? "ACTIVE"}
          />
        </Bloco>

        {/* -------------------------------------------------------- o que assiste */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Onde esta pessoa mora"
            descricao="Tempo assistido por novela"
            compacto
          >
            {ficha.novelasAcompanhadas.length === 0 ? (
              <Vazio
                titulo="Ainda não assistiu nada"
                descricao="Nenhum episódio foi iniciado por esta conta."
              />
            ) : (
              <Tabela
                cabecalho={
                  <tr>
                    <Th>Novela</Th>
                    <Th alinhar="direita">Episódios</Th>
                    <Th alinhar="direita">Assistido</Th>
                    <Th alinhar="direita">Última vez</Th>
                  </tr>
                }
              >
                {ficha.novelasAcompanhadas.map((linha) => (
                  <tr key={linha.novelaId} className="painel-linha">
                    <Td className="max-w-[12rem] truncate">
                      <Link
                        href={`/painel/streaming/${linha.slug}`}
                        className="hover:text-[var(--color-rose-300)]"
                      >
                        {linha.titulo}
                      </Link>
                    </Td>
                    <Td alinhar="direita">
                      <span className="tabular">
                        {linha.concluidos}
                        <span className="text-[var(--p-fraco)]">
                          /{linha.episodios}
                        </span>
                      </span>
                    </Td>
                    <Td alinhar="direita">{fmtDuracao(linha.assistidoMs)}</Td>
                    <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDesde(linha.ultimoEm)}
                    </Td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Bloco>

          <Bloco titulo="Progresso recente" descricao="Últimos episódios tocados" compacto>
            {ficha.progresso.length === 0 ? (
              <Vazio titulo="Sem progresso registrado" />
            ) : (
              <Tabela
                cabecalho={
                  <tr>
                    <Th>Episódio</Th>
                    <Th alinhar="direita">Parou em</Th>
                    <Th alinhar="direita">%</Th>
                    <Th alinhar="direita">Quando</Th>
                  </tr>
                }
              >
                {ficha.progresso.slice(0, 12).map((linha) => (
                  <tr key={linha.id} className="painel-linha">
                    <Td className="max-w-[15rem]">
                      <span className="block truncate">{linha.episode.title}</span>
                      <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                        {linha.novela.title} · ep. {linha.episode.number}
                      </span>
                    </Td>
                    <Td alinhar="direita" className="whitespace-nowrap">
                      {fmtRelogio(linha.positionSec)}
                      <span className="text-[var(--p-fraco)]">
                        /{fmtRelogio(linha.durationSec)}
                      </span>
                    </Td>
                    <Td alinhar="direita">
                      {linha.completed ? (
                        <Selo tom="bom">fim</Selo>
                      ) : (
                        <span className="tabular">{linha.percent}%</span>
                      )}
                    </Td>
                    <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDesde(linha.updatedAt)}
                    </Td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Bloco>
        </div>

        {/* ------------------------------------------------ sessões e pagamentos */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco titulo="Sessões" descricao="As 20 mais recentes" compacto>
            {ficha.sessoes.length === 0 ? (
              <Vazio titulo="Nenhuma sessão registrada" />
            ) : (
              <Tabela
                cabecalho={
                  <tr>
                    <Th>Aparelho</Th>
                    <Th alinhar="direita">Duração</Th>
                    <Th alinhar="direita">Telas</Th>
                    <Th alinhar="direita">Início</Th>
                  </tr>
                }
              >
                {ficha.sessoes.map((sessao) => (
                  <tr key={sessao.id} className="painel-linha">
                    <Td>
                      <span className="flex items-center gap-1.5">
                        {rotuloDeDispositivo(sessao.osName, sessao.browser)}
                        {sessao.standalone ? <Selo tom="info">app</Selo> : null}
                        {!sessao.endedAt ? <Selo tom="bom">aberta</Selo> : null}
                      </span>
                    </Td>
                    <Td alinhar="direita">{fmtDuracao(sessao.durationMs)}</Td>
                    <Td alinhar="direita">{sessao.screenViews}</Td>
                    <Td alinhar="direita" className="whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDataHora(sessao.startedAt)}
                    </Td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Bloco>

          <Bloco titulo="Pagamentos" compacto>
            {ficha.pagamentos.length === 0 ? (
              <Vazio
                titulo="Nenhum pagamento registrado"
                descricao="Ainda não há integração com provedor de pagamento; mudanças de plano feitas pelo painel aparecem na auditoria, não aqui."
              />
            ) : (
              <Tabela
                cabecalho={
                  <tr>
                    <Th>Quando</Th>
                    <Th>Situação</Th>
                    <Th alinhar="direita">Valor</Th>
                  </tr>
                }
              >
                {ficha.pagamentos.map((pagamento) => (
                  <tr key={pagamento.id} className="painel-linha">
                    <Td className="whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDataHora(pagamento.createdAt)}
                    </Td>
                    <Td>
                      <Selo
                        tom={
                          pagamento.status === "APPROVED"
                            ? "bom"
                            : pagamento.status === "FAILED"
                              ? "perigo"
                              : "atencao"
                        }
                      >
                        {pagamento.status}
                      </Selo>
                      {pagamento.isDemo ? <Selo>demonstração</Selo> : null}
                    </Td>
                    <Td alinhar="direita">{fmtMoeda(pagamento.amountCents)}</Td>
                  </tr>
                ))}
              </Tabela>
            )}
          </Bloco>
        </div>

        {/* --------------------------------------------- comunidade e descoberta */}
        <div className="grid items-start gap-5 lg:grid-cols-3">
          <Bloco titulo="Minha lista" compacto>
            {ficha.favoritos.length === 0 ? (
              <Vazio titulo="Lista vazia" />
            ) : (
              <ul className="space-y-1.5">
                {ficha.favoritos.map((favorito) => (
                  <li
                    key={favorito.id}
                    className="flex items-center justify-between gap-2 text-[0.8125rem]"
                  >
                    <span className="truncate">{favorito.novela.title}</span>
                    <span className="shrink-0 text-[0.6875rem] text-[var(--p-fraco)]">
                      {fmtDesde(favorito.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          <Bloco titulo="O que procurou" compacto>
            {ficha.buscas.length === 0 ? (
              <Vazio titulo="Nenhuma busca" />
            ) : (
              <ul className="space-y-1.5">
                {ficha.buscas.map((busca) => (
                  <li
                    key={busca.id}
                    className="flex items-center justify-between gap-2 text-[0.8125rem]"
                  >
                    <span className="truncate">“{busca.term}”</span>
                    <span className="shrink-0 text-[0.6875rem] text-[var(--p-fraco)]">
                      {busca.resultCount === 0 ? (
                        <span className="text-[var(--p-atencao)]">sem resultado</span>
                      ) : (
                        `${busca.resultCount} resultados`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          <Bloco titulo="Comunidade" compacto>
            <Razao>
              <LinhaRazao
                rotulo="Publicações"
                valor={fmtNumero(ficha.posts.length)}
              />
              <LinhaRazao
                rotulo="Comentários"
                valor={fmtNumero(ficha.comentarios.length)}
              />
            </Razao>
            {ficha.posts.length > 0 ? (
              <ul className="mt-3 space-y-2 border-t border-[var(--p-linha)] pt-3">
                {ficha.posts.slice(0, 4).map((post) => (
                  <li key={post.id} className="text-[0.8125rem]">
                    <p className="line-clamp-2 text-[var(--p-suave)]">
                      {post.body}
                    </p>
                    <p className="text-[0.6875rem] text-[var(--p-fraco)]">
                      {post.novela?.title ?? "sem novela"} ·{" "}
                      {fmtDesde(post.createdAt)}
                      {post.hiddenAt ? " · oculto" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Bloco>
        </div>

        {/* ------------------------------------------------- eventos e auditoria */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco
            titulo="Eventos recentes"
            descricao="O que esta pessoa fez, em ordem"
            compacto
          >
            {ficha.eventos.length === 0 ? (
              <Vazio titulo="Nenhum evento registrado" />
            ) : (
              <ul className="max-h-[26rem] divide-y divide-[var(--p-linha)] overflow-y-auto">
                {ficha.eventos.map((evento) => (
                  <li key={evento.id} className="flex items-baseline gap-3 py-2">
                    <span className="tabular w-24 shrink-0 text-[0.6875rem] text-[var(--p-fraco)]">
                      {fmtDataHora(evento.createdAt).slice(11)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[0.8125rem] text-[var(--p-texto)]">
                        {evento.type}
                      </span>
                      {evento.novelaTitulo || evento.episodio ? (
                        <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                          {evento.novelaTitulo}
                          {evento.episodio ? ` · ${evento.episodio.title}` : ""}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[0.6875rem] text-[var(--p-fraco)]">
                      {fmtDesde(evento.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>

          <Bloco
            titulo="O que já fizemos nesta conta"
            descricao="Ações administrativas registradas"
            compacto
          >
            {ficha.acoesAdministrativas.length === 0 ? (
              <Vazio
                titulo="Nenhuma ação administrativa"
                descricao="Nenhum administrador alterou esta conta pelo painel."
              />
            ) : (
              <ul className="divide-y divide-[var(--p-linha)]">
                {ficha.acoesAdministrativas.map((acao) => (
                  <li key={acao.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <Selo
                        tom={
                          acao.severity === "CRITICAL"
                            ? "perigo"
                            : acao.severity === "WARNING"
                              ? "atencao"
                              : "neutro"
                        }
                      >
                        {acao.action}
                      </Selo>
                      <span className="text-[0.6875rem] text-[var(--p-fraco)]">
                        {fmtDataHora(acao.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-[0.75rem] text-[var(--p-suave)]">
                      por {acao.actorName}
                      {(acao.context as { motivo?: string })?.motivo
                        ? ` — ${(acao.context as { motivo?: string }).motivo}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Bloco>
        </div>
      </Conteudo>
    </>
  );
}
