"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { BotaoPainel, Selo } from "@/components/painel/primitivos";
import {
  ajustarBiblioteca,
  cancelarVarredura,
  criarBiblioteca,
  pedirVarredura,
  removerBiblioteca,
} from "@/lib/painel/acoes/bibliotecas";
import type { LinhaDeBiblioteca } from "@/lib/painel/bibliotecas";
import { fmtBytes, fmtDesde, fmtNumero } from "@/lib/painel/numeros";

type Resposta = { ok: true; mensagem: string } | { ok: false; erro: string } | null;

function Aviso({ valor }: { valor: Resposta }) {
  if (!valor) return null;
  return (
    <span
      role="status"
      className={`text-[0.75rem] ${valor.ok ? "text-[var(--p-bom)]" : "text-[var(--p-perigo)]"}`}
    >
      {valor.ok ? valor.mensagem : valor.erro}
    </span>
  );
}

/**
 * Acompanhamento de uma varredura em andamento.
 *
 * Atualiza sozinho enquanto há trabalho e para quando acaba. Uma barra que
 * exige recarregar a página não é progresso — é um número velho.
 */
function Progresso({
  emAndamento,
}: {
  emAndamento: NonNullable<LinhaDeBiblioteca["emAndamento"]>;
}) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [router]);

  const percentual =
    emAndamento.total > 0
      ? Math.min(100, (emAndamento.processados / emAndamento.total) * 100)
      : 0;

  return (
    <div className="mt-3 rounded-lg border border-[var(--p-linha)] bg-[var(--p-elevado)] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-[0.8125rem] text-[var(--p-texto)]">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="painel-pulso absolute inline-flex h-full w-full rounded-full bg-[var(--p-acento)]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--p-acento)]" />
          </span>
          {emAndamento.etapa ??
            (emAndamento.estado === "QUEUED" ? "na fila" : "trabalhando")}
        </span>
        <span className="tabular text-[0.75rem] text-[var(--p-fraco)]">
          {emAndamento.total > 0
            ? `${fmtNumero(emAndamento.processados)} de ${fmtNumero(emAndamento.total)}`
            : "contando"}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--p-superficie)]">
        <div
          className={`h-full rounded-full bg-[var(--p-acento)] transition-[width] duration-500 ${
            emAndamento.total === 0 ? "w-1/4 animate-pulse" : ""
          }`}
          style={emAndamento.total > 0 ? { width: `${percentual}%` } : undefined}
        />
      </div>
    </div>
  );
}

export function CartaoDeBiblioteca({
  biblioteca,
  podeGerenciar,
}: {
  biblioteca: LinhaDeBiblioteca;
  podeGerenciar: boolean;
}) {
  const [resposta, setResposta] = useState<Resposta>(null);
  const [pendente, iniciar] = useTransition();

  const ocupada = biblioteca.emAndamento !== null;

  return (
    <section className="painel-cartao overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-linha)] px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-[var(--p-texto)]">
            {biblioteca.nome}
            {!biblioteca.habilitada ? (
              <Selo tom="neutro">desabilitada</Selo>
            ) : null}
            {!biblioteca.autoImport ? (
              <Selo tom="info">só inventário</Selo>
            ) : null}
          </h3>
          <p className="mt-0.5 font-mono text-[0.75rem] break-all text-[var(--p-fraco)]">
            {biblioteca.caminho}
          </p>
          <p className="mt-1 text-[0.6875rem] text-[var(--p-fraco)]">
            {biblioteca.servidor
              ? `em ${biblioteca.servidor.nome}`
              : "nenhum agente reivindicou esta pasta ainda"}
            {biblioteca.ultimaVarreduraEm
              ? ` · varrida ${fmtDesde(biblioteca.ultimaVarreduraEm)}`
              : " · nunca varrida"}
          </p>
        </div>

        {podeGerenciar ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <BotaoPainel
              variante="principal"
              disabled={pendente || ocupada || !biblioteca.habilitada}
              onClick={() =>
                iniciar(async () =>
                  setResposta(
                    await pedirVarredura({ bibliotecaId: biblioteca.id }),
                  ),
                )
              }
            >
              {ocupada ? "Escaneando…" : "Escanear"}
            </BotaoPainel>
            <AcaoProtegida
              rotulo="Completa"
              titulo="Varredura completa?"
              descricao="Relê metadados e recalcula o checksum de cada arquivo, em vez de confiar no tamanho. É o que detecta um vídeo corrompido que manteve o tamanho — e leva muito mais tempo."
              confirmar="Escanear tudo"
              variante="sutil"
              desabilitado={ocupada || !biblioteca.habilitada}
              acao={async () =>
                pedirVarredura({ bibliotecaId: biblioteca.id, completa: true })
              }
            />
          </div>
        ) : null}
      </header>

      <div className="px-5 py-4">
        {ocupada ? (
          <Progresso emAndamento={biblioteca.emAndamento!} />
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {[
              ["Novelas", fmtNumero(biblioteca.novelas)],
              ["Episódios", fmtNumero(biblioteca.episodios)],
              ["Arquivos", fmtNumero(biblioteca.arquivos)],
              ["Tamanho", fmtBytes(biblioteca.bytes)],
            ].map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-[0.6875rem] tracking-wide text-[var(--p-fraco)] uppercase">
                  {rotulo}
                </dt>
                <dd className="numero mt-0.5 text-[1rem] font-semibold text-[var(--p-texto)]">
                  {valor}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {biblioteca.ultimoEstado === "FAILED" && !ocupada ? (
          <p className="mt-3 text-[0.75rem] text-[var(--p-perigo)]">
            A última varredura falhou. O motivo está no histórico abaixo.
          </p>
        ) : null}

        {podeGerenciar ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--p-linha)] pt-3">
            <BotaoPainel
              variante="fantasma"
              disabled={pendente}
              onClick={() =>
                iniciar(async () =>
                  setResposta(
                    await ajustarBiblioteca({
                      bibliotecaId: biblioteca.id,
                      habilitada: !biblioteca.habilitada,
                    }),
                  ),
                )
              }
            >
              {biblioteca.habilitada ? "Desabilitar" : "Habilitar"}
            </BotaoPainel>
            <BotaoPainel
              variante="fantasma"
              disabled={pendente}
              onClick={() =>
                iniciar(async () =>
                  setResposta(
                    await ajustarBiblioteca({
                      bibliotecaId: biblioteca.id,
                      autoImport: !biblioteca.autoImport,
                    }),
                  ),
                )
              }
            >
              {biblioteca.autoImport
                ? "Parar de criar catálogo"
                : "Criar catálogo ao varrer"}
            </BotaoPainel>
            {ocupada ? (
              <AcaoProtegida
                rotulo="Cancelar varredura"
                titulo="Cancelar esta varredura?"
                descricao="O agente para no próximo reporte de progresso. Nada do que já foi lido é gravado — a importação só acontece quando a leitura termina inteira."
                confirmar="Cancelar"
                variante="perigo"
                perigo
                acao={async () =>
                  cancelarVarredura({
                    bibliotecaId: biblioteca.emAndamento!.id,
                  })
                }
              />
            ) : (
              <AcaoProtegida
                rotulo="Remover"
                titulo={`Remover a biblioteca "${biblioteca.nome}"?`}
                descricao="Some a declaração de onde procurar. As novelas continuam no catálogo e os arquivos continuam no disco — para tirar conteúdo do ar, use o Catálogo, onde a decisão fica à vista."
                confirmar="Remover biblioteca"
                variante="perigo"
                perigo
                pedirMotivo
                acao={async (motivo) =>
                  removerBiblioteca({ bibliotecaId: biblioteca.id, motivo })
                }
              />
            )}
            <Aviso valor={resposta} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function NovaBiblioteca({
  servidores,
  podeGerenciar,
}: {
  servidores: { id: string; nome: string; slug: string }[];
  podeGerenciar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [caminho, setCaminho] = useState("");
  const [servidorId, setServidorId] = useState<string>("");
  const [autoImport, setAutoImport] = useState(true);
  const [resposta, setResposta] = useState<Resposta>(null);
  const [pendente, iniciar] = useTransition();

  if (!podeGerenciar) return null;

  if (!aberto) {
    return (
      <BotaoPainel variante="principal" onClick={() => setAberto(true)}>
        Adicionar biblioteca
      </BotaoPainel>
    );
  }

  const enviar = () =>
    iniciar(async () => {
      const r = await criarBiblioteca({
        nome: nome.trim(),
        caminho: caminho.trim(),
        servidorId: servidorId || null,
        autoImport,
        publicarAoImportar: false,
      });
      setResposta(r);
      if (r.ok) {
        setNome("");
        setCaminho("");
        setAberto(false);
      }
    });

  return (
    <section className="painel-cartao overflow-hidden">
      <header className="border-b border-[var(--p-linha)] px-5 py-4">
        <h3 className="text-[0.9375rem] font-semibold text-[var(--p-texto)]">
          Nova biblioteca
        </h3>
        <p className="mt-0.5 max-w-[70ch] text-[0.75rem] leading-relaxed text-[var(--p-fraco)]">
          O caminho é da máquina que guarda os vídeos, não deste servidor. A
          aplicação nunca abre essa pasta — quem abre é o agente, e é a primeira
          varredura que diz se o caminho existe.
        </p>
      </header>

      <div className="space-y-4 px-5 py-4">
        <label className="block">
          <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
            Nome
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Novelas verticais"
            className="mt-1 h-8 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 text-[0.8125rem] text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
            Caminho na máquina do agente
          </span>
          <input
            value={caminho}
            onChange={(e) => setCaminho(e.target.value)}
            placeholder="D:/Noveleiras de Plantão"
            spellCheck={false}
            className="mt-1 h-8 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 font-mono text-[0.8125rem] text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none"
          />
          <span className="mt-1 block text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
            Uma pasta por novela, episódios numerados no nome — <code>Nome - E01.mp4</code>,{" "}
            <code>S01E01</code> e <code>ep 1</code> são lidos.
          </span>
        </label>

        {servidores.length > 0 ? (
          <label className="block">
            <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
              Máquina
            </span>
            <select
              value={servidorId}
              onChange={(e) => setServidorId(e.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)] focus:border-[var(--p-acento)] focus:outline-none"
            >
              <option value="">
                Qualquer agente — o primeiro que pegar assume
              </option>
              {servidores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} ({s.slug})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex cursor-pointer items-start gap-2 text-[0.8125rem] text-[var(--p-suave)]">
          <input
            type="checkbox"
            checked={autoImport}
            onChange={() => setAutoImport((v) => !v)}
            className="mt-0.5 accent-[var(--color-rose-600)]"
          />
          <span>
            Criar catálogo a partir das pastas
            <span className="block text-[0.6875rem] text-[var(--p-fraco)]">
              Desmarcado, a varredura só inventaria arquivos e confere
              integridade, sem criar novela nenhuma.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <BotaoPainel
            variante="principal"
            disabled={pendente || nome.trim().length === 0 || caminho.trim().length < 2}
            onClick={enviar}
          >
            {pendente ? "Registrando…" : "Registrar biblioteca"}
          </BotaoPainel>
          <BotaoPainel variante="fantasma" onClick={() => setAberto(false)}>
            Cancelar
          </BotaoPainel>
          <Aviso valor={resposta} />
        </div>
      </div>
    </section>
  );
}
