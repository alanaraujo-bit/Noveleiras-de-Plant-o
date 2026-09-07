"use client";

import { useState, useTransition } from "react";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { BotaoPainel, LinkPainel, Selo } from "@/components/painel/primitivos";
import {
  ajustarPermissoes,
  concederAcesso,
  revogarAcesso,
} from "@/lib/painel/acoes/administradores";
import {
  GRUPOS_DE_PERMISSAO,
  PERFIS,
  PERMISSOES,
  type Permissao,
} from "@/lib/painel/permissoes";

/**
 * Controles de acesso.
 *
 * Cliente porque cada botão fecha sobre o seu alvo e porque o formulário de
 * permissões é um estado que só existe enquanto se edita. A autoridade
 * continua no servidor: `podeGerenciar` decide o que aparece, nunca o que é
 * permitido — e nenhuma destas ações confia no que este componente enviou
 * sem reconferir.
 */

export function RevogarAcesso({
  userId,
  nome,
  ehVoce,
  ultimoAdmin,
  podeGerenciar,
}: {
  userId: string;
  nome: string;
  ehVoce: boolean;
  ultimoAdmin: boolean;
  podeGerenciar: boolean;
}) {
  if (!podeGerenciar) return null;

  // A trava real está no servidor; aqui o botão explica por que não dá, em vez
  // de sumir e deixar a pessoa procurando.
  if (ehVoce) {
    return (
      <span className="text-[0.6875rem] text-[var(--p-fraco)]">
        seu próprio acesso
      </span>
    );
  }
  if (ultimoAdmin) {
    return (
      <span className="text-[0.6875rem] text-[var(--p-fraco)]">
        último administrador
      </span>
    );
  }

  return (
    <AcaoProtegida
      rotulo="Revogar"
      titulo={`Revogar o acesso de ${nome}?`}
      descricao="A pessoa perde o painel imediatamente e as sessões abertas são encerradas — sem isso, o cookie que ela já tem continuaria valendo. A conta em si permanece, como usuária comum."
      confirmar="Revogar acesso"
      variante="perigo"
      perigo
      pedirMotivo
      acao={(motivo) => revogarAcesso({ userId, motivo })}
    />
  );
}

const PAPEIS = [
  {
    valor: "EDITOR" as const,
    nome: "Editor",
    descricao: "Alcança só o que for marcado abaixo.",
  },
  {
    valor: "ADMIN" as const,
    nome: "Administrador",
    descricao: "Alcança tudo, inclusive conceder acesso a outras pessoas.",
  },
];

export function FormularioDeAcesso({
  userId,
  nome,
  papelAtual,
  permissoesAtuais,
  novo,
}: {
  userId: string;
  nome: string;
  papelAtual: "USER" | "EDITOR" | "ADMIN";
  permissoesAtuais: Permissao[];
  /** Concessão inicial muda o texto: conceder não é o mesmo que ajustar. */
  novo?: boolean;
}) {
  const [papel, setPapel] = useState<"EDITOR" | "ADMIN">(
    papelAtual === "ADMIN" ? "ADMIN" : "EDITOR",
  );
  const [marcadas, setMarcadas] = useState<Set<Permissao>>(
    new Set(permissoesAtuais),
  );
  const [motivo, setMotivo] = useState("");
  const [resposta, setResposta] = useState<
    { ok: true; mensagem: string } | { ok: false; erro: string } | null
  >(null);
  const [pendente, iniciar] = useTransition();

  const alternar = (permissao: Permissao) => {
    setMarcadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(permissao)) proxima.delete(permissao);
      else proxima.add(permissao);
      return proxima;
    });
  };

  const aplicarPerfil = (chave: string) => {
    const perfil = PERFIS[chave];
    if (perfil) setMarcadas(new Set(perfil.permissoes));
  };

  const enviar = () => {
    iniciar(async () => {
      const permissoes = [...marcadas];
      const resultado =
        papelAtual === "USER" || papel !== papelAtual
          ? await concederAcesso({
              userId,
              papel,
              permissoes,
              motivo: motivo || undefined,
            })
          : await ajustarPermissoes({
              userId,
              permissoes,
              motivo: motivo || undefined,
            });
      setResposta(resultado);
    });
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
          Papel
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PAPEIS.map((opcao) => (
            <label
              key={opcao.valor}
              className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors ${
                papel === opcao.valor
                  ? "border-[var(--color-rose-500)]/40 bg-[var(--p-acento-suave)]"
                  : "border-[var(--p-linha)] hover:bg-white/4"
              }`}
            >
              <input
                type="radio"
                name={`papel-${userId}`}
                value={opcao.valor}
                checked={papel === opcao.valor}
                onChange={() => setPapel(opcao.valor)}
                className="mt-0.5 accent-[var(--color-rose-600)]"
              />
              <span className="min-w-0">
                <span className="block text-[0.8125rem] font-medium text-[var(--p-texto)]">
                  {opcao.nome}
                </span>
                <span className="block text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
                  {opcao.descricao}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {papel === "ADMIN" ? (
        <p className="rounded-lg border border-[var(--p-linha)] bg-[var(--p-elevado)] px-3 py-2.5 text-[0.75rem] leading-relaxed text-[var(--p-suave)]">
          Administrador alcança todas as permissões por definição — inclusive
          conceder e revogar acesso. Marcar permissões individuais não se aplica
          a este papel.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
              Perfis prontos
            </span>
            {Object.entries(PERFIS).map(([chave, perfil]) => (
              <button
                key={chave}
                type="button"
                onClick={() => aplicarPerfil(chave)}
                title={perfil.descricao}
                className="h-7 rounded-md border border-[var(--p-linha)] px-2.5 text-[0.75rem] text-[var(--p-suave)] transition-colors hover:bg-white/6"
              >
                {perfil.nome}
              </button>
            ))}
            <span className="text-[0.6875rem] text-[var(--p-fraco)]">
              preenchem a lista; a permissão continua sendo a unidade real
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {GRUPOS_DE_PERMISSAO.map((grupo) => (
              <fieldset
                key={grupo.titulo}
                className="rounded-lg border border-[var(--p-linha)] p-3"
              >
                <legend className="px-1 text-[0.6875rem] font-semibold text-[var(--p-suave)]">
                  {grupo.titulo}
                </legend>
                <div className="space-y-1.5">
                  {grupo.permissoes.map((permissao) => (
                    <label
                      key={permissao}
                      className="flex cursor-pointer items-start gap-2 text-[0.75rem] text-[var(--p-suave)]"
                    >
                      <input
                        type="checkbox"
                        checked={marcadas.has(permissao)}
                        onChange={() => alternar(permissao)}
                        className="mt-0.5 accent-[var(--color-rose-600)]"
                      />
                      <span className="min-w-0">
                        {PERMISSOES[permissao]}
                        <span className="block text-[0.625rem] text-[var(--p-fraco)]">
                          {permissao}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <p className="text-[0.6875rem] text-[var(--p-fraco)]">
            {marcadas.size === 0
              ? "Nenhuma permissão marcada — um editor assim não abre nenhuma tela."
              : `${marcadas.size} ${marcadas.size === 1 ? "permissão marcada" : "permissões marcadas"}`}
          </p>
        </>
      )}

      <label className="block">
        <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
          Motivo
        </span>
        <input
          type="text"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          placeholder="Vai para a auditoria junto com a mudança"
          className="mt-1 h-8 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 text-[0.8125rem] text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <BotaoPainel
          variante="principal"
          onClick={enviar}
          disabled={pendente || (papel === "EDITOR" && marcadas.size === 0)}
        >
          {pendente
            ? "Gravando…"
            : novo
              ? "Conceder acesso"
              : "Salvar acesso"}
        </BotaoPainel>
        {resposta ? (
          <span
            className={`text-[0.75rem] ${
              resposta.ok ? "text-[var(--p-bom)]" : "text-[var(--p-perigo)]"
            }`}
            role="status"
          >
            {resposta.ok ? resposta.mensagem : resposta.erro}
          </span>
        ) : null}
      </div>
      <p className="text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
        A mudança vale para {nome} no próximo carregamento de página dela. Toda
        alteração de acesso entra na auditoria como crítica.
      </p>
    </div>
  );
}

/** Busca uma conta comum para conceder acesso pela primeira vez. */
export function BuscaDeCandidato({
  candidatos,
}: {
  candidatos: { id: string; nome: string; email: string; handle: string; demo: boolean }[];
}) {
  if (candidatos.length === 0) return null;

  return (
    <ul className="divide-y divide-[var(--p-linha)]">
      {candidatos.map((pessoa) => (
        <li
          key={pessoa.id}
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] text-[var(--p-texto)]">
              {pessoa.nome}
              {pessoa.demo ? (
                <span className="ml-1.5">
                  <Selo tom="neutro">demonstração</Selo>
                </span>
              ) : null}
            </p>
            <p className="truncate text-[0.6875rem] text-[var(--p-fraco)]">
              {pessoa.email} · @{pessoa.handle}
            </p>
          </div>
          <LinkPainel
            variante="principal"
            href={`/painel/administradores/${pessoa.id}`}
          >
            Conceder acesso
          </LinkPainel>
        </li>
      ))}
    </ul>
  );
}
