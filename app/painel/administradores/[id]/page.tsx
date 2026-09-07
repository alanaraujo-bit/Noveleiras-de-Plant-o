import Link from "next/link";
import { notFound } from "next/navigation";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { FormularioDeAcesso } from "@/components/painel/AdministradoresAcoes";
import { Diferenca, SeloDeSeveridade } from "@/components/painel/Auditoria";
import {
  Bloco,
  LinhaRazao,
  Migalhas,
  Razao,
  Selo,
  Vazio,
} from "@/components/painel/primitivos";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  administrador,
  listarAuditoria,
} from "@/lib/painel/metricas/auditoria";
import { fmtDataHora, fmtDesde, fmtNumero } from "@/lib/painel/numeros";
import { GRUPOS_DE_PERMISSAO, PERMISSOES } from "@/lib/painel/permissoes";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Acesso ao painel" };

type Params = Promise<{ id: string }>;
type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDoAdministrador({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("admins.ver");

  const { id } = await params;
  const busca = await searchParams;
  const periodo = resolverPeriodo(busca.periodo, {
    de: busca.de,
    ate: busca.ate,
  });
  const sufixo = sufixoDoPeriodo(busca);
  const podeGerenciar = operador.pode("admins.gerenciar");

  // A tela serve dois casos: alguém da equipe, e uma conta comum a quem se vai
  // conceder acesso. O segundo só existe para quem pode conceder.
  const daEquipe = await administrador(id);
  const conta = daEquipe
    ? null
    : podeGerenciar
      ? await db.user.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            email: true,
            handle: true,
            role: true,
            status: true,
            createdAt: true,
            lastSeenAt: true,
            isDemo: true,
          },
        })
      : null;

  if (!daEquipe && !conta) notFound();

  const pessoa = daEquipe ?? conta!;
  const novo = !daEquipe;
  const ehVoce = pessoa.id === operador.id;

  const trilha = await listarAuditoria({
    periodo,
    atorId: pessoa.id,
    porPagina: 12,
  });

  return (
    <>
      <Cabecalho
        titulo={pessoa.name}
        descricao={`${pessoa.email} · @${pessoa.handle}`}
        acoes={null}
      />

      <Conteudo className="space-y-5">
        <Migalhas
          itens={[
            { rotulo: "Administradores", href: `/painel/administradores${sufixo}` },
            { rotulo: pessoa.name },
          ]}
        />

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Bloco titulo="A conta" descricao="Situação e histórico de entrada">
            <Razao>
              <LinhaRazao
                rotulo="Papel"
                valor={
                  pessoa.role === "ADMIN"
                    ? "administrador"
                    : pessoa.role === "EDITOR"
                      ? "editor"
                      : "usuária comum"
                }
                destaque
              />
              <LinhaRazao
                rotulo="Situação"
                valor={pessoa.status.toLowerCase()}
                nota={
                  pessoa.status !== "ACTIVE"
                    ? "uma conta não ativa não entra, mesmo com acesso concedido"
                    : undefined
                }
              />
              <LinhaRazao
                rotulo="Último acesso"
                valor={
                  pessoa.lastSeenAt ? fmtDesde(pessoa.lastSeenAt) : "nunca entrou"
                }
                nota={
                  pessoa.lastSeenAt ? fmtDataHora(pessoa.lastSeenAt) : undefined
                }
              />
              <LinhaRazao
                rotulo="Conta criada"
                valor={fmtDataHora(pessoa.createdAt)}
              />
              {operador.pode("usuarios.ver") ? (
                <LinhaRazao
                  rotulo="Ficha completa"
                  valor="abrir em Usuários"
                  href={`/painel/usuarios/${pessoa.id}`}
                />
              ) : null}
            </Razao>
          </Bloco>

          <Bloco
            titulo="O que alcança hoje"
            descricao={
              daEquipe
                ? daEquipe.herdadas
                  ? "Herdado do papel, não concedido pessoa a pessoa"
                  : "Concedido explicitamente"
                : "Esta conta ainda não alcança o painel"
            }
          >
            {!daEquipe ? (
              <p className="py-6 text-center text-[0.8125rem] text-[var(--p-fraco)]">
                Nenhuma permissão. Use o formulário abaixo para conceder acesso.
              </p>
            ) : daEquipe.role === "ADMIN" ? (
              <p className="py-6 text-center text-[0.8125rem] leading-relaxed text-[var(--p-suave)]">
                Todas as {fmtNumero(daEquipe.efetivas.length)} permissões, por
                definição do papel de administrador.
              </p>
            ) : (
              <div className="space-y-3">
                {GRUPOS_DE_PERMISSAO.map((grupo) => {
                  const tem = grupo.permissoes.filter((permissao) =>
                    daEquipe.efetivas.includes(permissao),
                  );
                  if (tem.length === 0) return null;
                  return (
                    <div key={grupo.titulo}>
                      <p className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
                        {grupo.titulo}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {tem.map((permissao) => (
                          <li
                            key={permissao}
                            className="text-[0.75rem] text-[var(--p-suave)]"
                          >
                            {PERMISSOES[permissao]}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {daEquipe.efetivas.length === 0 ? (
                  <p className="py-4 text-center text-[0.8125rem] text-[var(--p-fraco)]">
                    Nenhuma permissão — esta pessoa não abre nenhuma tela.
                  </p>
                ) : null}
              </div>
            )}
          </Bloco>
        </div>

        {podeGerenciar ? (
          ehVoce ? (
            <section className="painel-cartao px-5 py-6">
              <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                Este é o seu próprio acesso
              </h2>
              <p className="mt-1.5 max-w-[70ch] text-[0.8125rem] leading-relaxed text-[var(--p-fraco)]">
                Ninguém edita o próprio acesso, nem para ampliar nem para
                reduzir. Concessão é sempre ato de outra pessoa — é o que torna
                a trilha de auditoria uma prova, e não um bilhete que a pessoa
                escreveu para si mesma. Peça a outro administrador.
              </p>
            </section>
          ) : (
            <section className="painel-cartao overflow-hidden">
              <header className="border-b border-[var(--p-linha)] px-5 py-4">
                <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                  {novo ? "Conceder acesso" : "Ajustar acesso"}
                </h2>
                <p className="mt-0.5 max-w-[70ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
                  {novo
                    ? "Esta conta passa a alcançar o painel. Escolha o papel e, para editor, exatamente o que ela deve abrir."
                    : "A mudança vale no próximo carregamento de página da pessoa e entra na auditoria como crítica."}
                </p>
              </header>
              <div className="px-5 py-4">
                <FormularioDeAcesso
                  userId={pessoa.id}
                  nome={pessoa.name}
                  papelAtual={pessoa.role}
                  permissoesAtuais={daEquipe?.concedidas ?? []}
                  novo={novo}
                />
              </div>
            </section>
          )
        ) : null}

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              O que esta pessoa fez
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              {periodo.rotulo} · {fmtNumero(trilha.total)}{" "}
              {trilha.total === 1 ? "ação registrada" : "ações registradas"}
            </p>
          </header>
          {trilha.linhas.length === 0 ? (
            <Vazio
              titulo="Nenhuma ação neste recorte"
              descricao="A trilha registra o que foi feito pelo painel. Vazia aqui significa que esta pessoa não agiu no período — não que algo se perdeu."
            />
          ) : (
            <ul className="divide-y divide-[var(--p-linha)]">
              {trilha.linhas.map((linha) => (
                <li key={linha.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <SeloDeSeveridade severidade={linha.severidade} />
                    <code className="rounded bg-[var(--p-elevado)] px-1.5 py-0.5 text-[0.75rem] text-[var(--p-texto)]">
                      {linha.acao}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-[var(--p-suave)]">
                      {linha.alvoRotulo ?? linha.alvoId ?? linha.tipoDoAlvo}
                    </span>
                    <span className="text-[0.75rem] whitespace-nowrap text-[var(--p-fraco)]">
                      {fmtDataHora(linha.quando)}
                    </span>
                  </div>
                  <Diferenca antes={linha.antes} depois={linha.depois} />
                </li>
              ))}
            </ul>
          )}
          {trilha.total > trilha.linhas.length ? (
            <p className="border-t border-[var(--p-linha)] px-5 py-3 text-[0.75rem] text-[var(--p-fraco)]">
              Mostrando as {trilha.linhas.length} mais recentes.{" "}
              <Link
                href={`/painel/auditoria?ator=${pessoa.id}${sufixo ? `&${sufixo.slice(1)}` : ""}`}
                className="text-[var(--color-rose-300)] hover:underline"
              >
                Ver todas na auditoria
              </Link>
              .
            </p>
          ) : null}
        </section>
      </Conteudo>
    </>
  );
}
