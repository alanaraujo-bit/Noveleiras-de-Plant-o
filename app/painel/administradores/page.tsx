import Link from "next/link";

import { Cabecalho, Conteudo } from "@/components/painel/Cabecalho";
import { SeletorDePeriodo } from "@/components/painel/SeletorDePeriodo";
import { CampoDeBusca } from "@/components/painel/Filtros";
import {
  BuscaDeCandidato,
  RevogarAcesso,
} from "@/components/painel/AdministradoresAcoes";
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
import { IconeAdmin } from "@/components/painel/icones";
import { exigirPermissao } from "@/lib/painel/guarda";
import {
  candidatosAAdmin,
  contarAdminsAtivos,
  listarAdministradores,
} from "@/lib/painel/metricas/auditoria";
import { fmtDataCurta, fmtDesde, fmtNumero } from "@/lib/painel/numeros";
import { TODAS_PERMISSOES } from "@/lib/painel/permissoes";
import { resolverPeriodo, sufixoDoPeriodo } from "@/lib/painel/tempo";

export const metadata = { title: "Administradores" };

type Busca = Promise<Record<string, string | undefined>>;

export default async function PaginaDeAdministradores({
  searchParams,
}: {
  searchParams: Busca;
}) {
  const operador = await exigirPermissao("admins.ver");

  const params = await searchParams;
  const periodo = resolverPeriodo(params.periodo, {
    de: params.de,
    ate: params.ate,
  });
  const sufixo = sufixoDoPeriodo(params);
  const podeGerenciar = operador.pode("admins.gerenciar");

  const [equipe, adminsAtivos, candidatos] = await Promise.all([
    listarAdministradores(periodo),
    contarAdminsAtivos(),
    podeGerenciar && params.q ? candidatosAAdmin(params.q) : [],
  ]);

  const administradores = equipe.filter((pessoa) => pessoa.papel === "ADMIN");
  const editores = equipe.filter((pessoa) => pessoa.papel === "EDITOR");
  const inativos = equipe.filter((pessoa) => pessoa.status !== "ACTIVE");

  return (
    <>
      <Cabecalho
        titulo="Administradores"
        descricao={`${fmtNumero(equipe.length)} ${equipe.length === 1 ? "pessoa alcança" : "pessoas alcançam"} o painel · ${fmtNumero(adminsAtivos)} ${adminsAtivos === 1 ? "administrador ativo" : "administradores ativos"}`}
        acoes={<SeletorDePeriodo />}
      />

      <Conteudo className="space-y-5">
        <div className="grid items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Bloco titulo="Quem alcança" descricao="Estado do acesso agora">
            <Razao>
              <LinhaRazao
                rotulo="Administradores"
                valor={fmtNumero(administradores.length)}
                nota="alcançam tudo, inclusive conceder acesso"
                destaque
              />
              <LinhaRazao
                rotulo="Editores"
                valor={fmtNumero(editores.length)}
                nota="alcançam só o que foi concedido"
              />
              <LinhaRazao
                rotulo="Contas não ativas"
                valor={fmtNumero(inativos.length)}
                sentido="menor-melhor"
                nota="suspensas ou removidas que ainda constam na equipe"
              />
            </Razao>
          </Bloco>

          <Bloco titulo="Como a autoridade funciona" descricao="Vale para toda tela do painel">
            <ul className="space-y-2 text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
              <li>
                Quem decide é o servidor, em cada página e cada ação. Esconder um
                controle nunca substitui validar a permissão.
              </li>
              <li>
                Administrador tem tudo por definição — do contrário seria
                possível fechar a porta atrás de si e deixar a operação sem
                ninguém que possa reabrir.
              </li>
              <li>
                Ninguém edita o próprio acesso. Concessão é sempre ato de outra
                pessoa; é o que torna a auditoria uma prova.
              </li>
              <li>
                O último administrador ativo não pode ser revogado pela tela. A
                saída seria <code className="text-[var(--p-texto)]">npm run admin</code>{" "}
                com acesso ao banco.
              </li>
            </ul>
          </Bloco>

          <Bloco titulo="Vocabulário" descricao="O catálogo de permissões vive em código">
            <Razao>
              <LinhaRazao
                rotulo="Permissões existentes"
                valor={fmtNumero(TODAS_PERMISSOES.length)}
                nota="uma permissão sem tela é inútil; uma tela sem permissão é um buraco"
              />
            </Razao>
            <p className="mt-3 border-t border-[var(--p-linha)] pt-3 text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
              O catálogo é tipado: uma permissão escrita errado vira erro de
              compilação, não uma tela que ninguém consegue abrir e ninguém
              entende por quê.
            </p>
          </Bloco>
        </div>

        <section className="painel-cartao overflow-hidden">
          <header className="border-b border-[var(--p-linha)] px-5 py-4">
            <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
              A equipe
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--p-fraco)]">
              Abra uma pessoa para ver e ajustar o que ela alcança
            </p>
          </header>
          {equipe.length === 0 ? (
            <Vazio
              icone={<IconeAdmin tamanho={28} />}
              titulo="Ninguém tem acesso ao painel"
              descricao="Isto não deveria acontecer: você está vendo esta tela, então a sua conta alcança o painel. Se a lista está vazia, algo saiu do lugar."
            />
          ) : (
            <Tabela
              cabecalho={
                <tr>
                  <Th>Pessoa</Th>
                  <Th>Papel</Th>
                  <Th>Alcance</Th>
                  <Th alinhar="direita">Ações no período</Th>
                  <Th alinhar="direita">Último acesso</Th>
                  <Th alinhar="direita">
                    <span className="sr-only">Revogar</span>
                  </Th>
                </tr>
              }
            >
              {equipe.map((pessoa) => (
                <tr key={pessoa.id} className="painel-linha">
                  <Td>
                    <Link
                      href={`/painel/administradores/${pessoa.id}${sufixo}`}
                      className="block max-w-[20rem]"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium hover:text-[var(--color-rose-300)]">
                          {pessoa.nome}
                        </span>
                        {pessoa.id === operador.id ? (
                          <Selo tom="info">você</Selo>
                        ) : null}
                        {pessoa.status !== "ACTIVE" ? (
                          <Selo tom="atencao">
                            {pessoa.status.toLowerCase()}
                          </Selo>
                        ) : null}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-[var(--p-fraco)]">
                        {pessoa.email}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <Selo tom={pessoa.papel === "ADMIN" ? "acento" : "neutro"}>
                      {pessoa.papel === "ADMIN" ? "administrador" : "editor"}
                    </Selo>
                  </Td>
                  <Td>
                    <span className="block max-w-[16rem] text-[0.75rem]">
                      {pessoa.papel === "ADMIN" ? (
                        <span className="text-[var(--p-suave)]">
                          tudo, por definição do papel
                        </span>
                      ) : pessoa.herdadas ? (
                        <span className="text-[var(--p-suave)]">
                          {fmtNumero(pessoa.efetivas.length)} permissões
                          <span className="block text-[0.625rem] text-[var(--p-fraco)]">
                            herdadas do perfil editorial, não concedidas
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--p-suave)]">
                          {fmtNumero(pessoa.efetivas.length)} permissões
                          concedidas
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td alinhar="direita">
                    {pessoa.acoesNoPeriodo === 0 ? (
                      <span className="text-[var(--p-fraco)]">0</span>
                    ) : (
                      fmtNumero(pessoa.acoesNoPeriodo)
                    )}
                  </Td>
                  <Td alinhar="direita" className="whitespace-nowrap">
                    {pessoa.ultimoAcesso ? (
                      fmtDesde(pessoa.ultimoAcesso)
                    ) : (
                      <span className="text-[var(--p-fraco)]">nunca entrou</span>
                    )}
                  </Td>
                  <Td alinhar="direita">
                    <RevogarAcesso
                      userId={pessoa.id}
                      nome={pessoa.nome}
                      ehVoce={pessoa.id === operador.id}
                      ultimoAdmin={
                        pessoa.papel === "ADMIN" &&
                        pessoa.status === "ACTIVE" &&
                        adminsAtivos <= 1
                      }
                      podeGerenciar={podeGerenciar}
                    />
                  </Td>
                </tr>
              ))}
            </Tabela>
          )}
        </section>

        {podeGerenciar ? (
          <section className="painel-cartao overflow-hidden">
            <header className="border-b border-[var(--p-linha)] px-5 py-4">
              <h2 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
                Conceder acesso a alguém
              </h2>
              <p className="mt-0.5 max-w-[70ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
                Busque uma conta que já usa o produto. Acesso ao painel é
                concedido a uma pessoa existente — não se cria conta por aqui.
              </p>
            </header>
            <div className="border-b border-[var(--p-linha)] px-4 py-3">
              <CampoDeBusca
                placeholder="Buscar por e-mail, nome ou @handle…"
                largura="24rem"
              />
            </div>
            {!params.q ? (
              <p className="px-5 py-6 text-center text-[0.8125rem] text-[var(--p-fraco)]">
                Digite ao menos duas letras para procurar
              </p>
            ) : candidatos.length === 0 ? (
              <p className="px-5 py-6 text-center text-[0.8125rem] text-[var(--p-fraco)]">
                Nenhuma conta comum corresponde a “{params.q}”. Quem já está na
                equipe aparece na tabela acima.
              </p>
            ) : (
              <BuscaDeCandidato
                candidatos={candidatos.map((pessoa) => ({
                  id: pessoa.id,
                  nome: pessoa.name,
                  email: pessoa.email,
                  handle: pessoa.handle,
                  demo: pessoa.isDemo,
                }))}
              />
            )}
          </section>
        ) : null}
      </Conteudo>
    </>
  );
}
