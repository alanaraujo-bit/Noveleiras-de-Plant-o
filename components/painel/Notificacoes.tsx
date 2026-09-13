"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { Bloco, BotaoPainel, Selo } from "@/components/painel/primitivos";
import {
  enviarTeste,
  previaDoRelatorio,
  removerWebhook,
  salvarNotificacoes,
  verificarAgora,
} from "@/lib/painel/acoes/notificacoes";
import {
  INTERVALOS,
  proximoFechamento,
  type Intervalo,
} from "@/lib/painel/discord/janelas";
import {
  LISTA_DE_EVENTOS,
  TIPOS_DE_EVENTO,
  type EmbedDiscord,
  type MensagemDiscord,
  type TipoDeEvento,
} from "@/lib/painel/discord/mensagens";

/**
 * Tela de notificações.
 *
 * Duas colunas com papéis fixos: à esquerda o que se decide, à direita o que
 * vai chegar. A prévia acompanha a escolha — marcar "compra avulsa" abre a
 * prévia da compra, trocar o intervalo refaz o relatório com os números reais
 * daquela janela. Configurar notificação às cegas é como se acaba silenciando
 * o canal no terceiro dia.
 */

type Resposta = { ok: true; mensagem: string } | { ok: false; erro: string } | null;

export type ConfigVisivel = {
  temWebhook: boolean;
  webhookMascarado: string | null;
  ativo: boolean;
  eventos: TipoDeEvento[];
  relatorioAtivo: boolean;
  relatorioIntervalo: Intervalo;
  relatorioHora: number;
};

export type ExemploDeEvento = {
  tipo: TipoDeEvento;
  mensagem: MensagemDiscord;
  /** `false` = ainda não houve nenhum; a prévia usa um exemplo inventado. */
  real: boolean;
};

const hora2 = (h: number) => `${String(h).padStart(2, "0")}:00`;

const fmtProximo = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function Retorno({ valor }: { valor: Resposta }) {
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

function Chave({
  ligado,
  onChange,
  rotulo,
  desabilitado,
}: {
  ligado: boolean;
  onChange: (v: boolean) => void;
  rotulo: string;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => onChange(!ligado)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-45 ${
        ligado
          ? "border-[var(--color-rose-500)]/50 bg-[var(--color-rose-600)]"
          : "border-[var(--p-linha-forte)] bg-white/8"
      }`}
    >
      <span
        className={`inline-block size-4.5 rounded-full bg-white shadow transition-transform ${
          ligado ? "translate-x-5.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function PainelDeNotificacoes({
  podeGerenciar,
  tabelaPronta,
  config,
  previaInicial,
  exemplos,
}: {
  podeGerenciar: boolean;
  tabelaPronta: boolean;
  config: ConfigVisivel;
  previaInicial: MensagemDiscord;
  exemplos: ExemploDeEvento[];
}) {
  const [webhook, setWebhook] = useState("");
  const [ativo, setAtivo] = useState(config.ativo);
  const [eventos, setEventos] = useState<Set<TipoDeEvento>>(new Set(config.eventos));
  const [relatorioAtivo, setRelatorioAtivo] = useState(config.relatorioAtivo);
  const [intervalo, setIntervalo] = useState<Intervalo>(config.relatorioIntervalo);
  const [hora, setHora] = useState(config.relatorioHora);

  const [aba, setAba] = useState<"relatorio" | TipoDeEvento>("relatorio");
  const [previa, setPrevia] = useState(previaInicial);
  const [refazendo, refazer] = useTransition();

  const [resposta, setResposta] = useState<Resposta>(null);
  const [respostaTeste, setRespostaTeste] = useState<Resposta>(null);
  const [salvando, salvar] = useTransition();
  const [testando, testar] = useTransition();
  const [verificando, verificar] = useTransition();

  const bloqueado = !podeGerenciar || !tabelaPronta;

  // O relatório da prévia é o de verdade: trocar o intervalo refaz a conta.
  const primeiro = useRef(true);
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    refazer(async () => {
      const r = await previaDoRelatorio({ intervalo, hora });
      if (r.ok) setPrevia(r.mensagem);
    });
  }, [intervalo, hora]);

  const alterado = useMemo(() => {
    const mesmos =
      eventos.size === config.eventos.length &&
      config.eventos.every((e) => eventos.has(e));
    return (
      webhook.trim() !== "" ||
      ativo !== config.ativo ||
      !mesmos ||
      relatorioAtivo !== config.relatorioAtivo ||
      intervalo !== config.relatorioIntervalo ||
      hora !== config.relatorioHora
    );
  }, [webhook, ativo, eventos, relatorioAtivo, intervalo, hora, config]);

  const proximo = useMemo(
    () => proximoFechamento(intervalo, hora),
    [intervalo, hora],
  );

  const alternarEvento = (tipo: TipoDeEvento) => {
    setEventos((atual) => {
      const novo = new Set(atual);
      if (novo.has(tipo)) novo.delete(tipo);
      else novo.add(tipo);
      return novo;
    });
    setAba(tipo);
  };

  const enviar = () =>
    salvar(async () => {
      const r = await salvarNotificacoes({
        webhookUrl: webhook.trim(),
        ativo,
        eventos: LISTA_DE_EVENTOS.filter((e) => eventos.has(e)),
        relatorioAtivo,
        relatorioIntervalo: intervalo,
        relatorioHora: hora,
      });
      setResposta(r);
      if (r.ok) setWebhook("");
    });

  const exemploDaAba = aba === "relatorio" ? null : exemplos.find((e) => e.tipo === aba);
  const mensagemDaAba = aba === "relatorio" ? previa : exemploDaAba?.mensagem;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
      {/* ------------------------------------------------ o que se decide */}
      <div className="min-w-0 space-y-5">
        <Bloco
          titulo="Canal"
          descricao="O webhook é o endereço do canal. Quem tem o endereço posta nele — por isso ele nunca volta para a tela depois de salvo."
          acao={
            <Selo tom={config.ativo ? "bom" : "neutro"}>
              {config.ativo ? "ligado" : "desligado"}
            </Selo>
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
                Webhook do Discord
              </span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={webhook}
                disabled={bloqueado}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder={
                  config.webhookMascarado ??
                  "https://discord.com/api/webhooks/…"
                }
                className="mt-1 h-9 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2.5 font-mono text-[0.75rem] text-[var(--p-texto)] placeholder:text-[var(--p-fraco)] focus:border-[var(--p-acento)] focus:outline-none disabled:opacity-60"
              />
              <span className="mt-1 block text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
                {config.temWebhook
                  ? "Já existe um webhook salvo. Deixe em branco para mantê-lo, ou cole outro para trocar."
                  : "No Discord: Editar canal → Integrações → Webhooks → Novo webhook → Copiar URL."}
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-linha)] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-medium text-[var(--p-texto)]">
                  Enviar para o canal
                </p>
                <p className="text-[0.6875rem] text-[var(--p-fraco)]">
                  Desligado, nada sai — nem aviso, nem relatório. Ligar não
                  despeja o histórico: só o que acontecer daqui para frente.
                </p>
              </div>
              <Chave
                ligado={ativo}
                onChange={setAtivo}
                rotulo="Enviar para o canal"
                desabilitado={bloqueado}
              />
            </div>

            {podeGerenciar ? (
              <div className="flex flex-wrap items-center gap-2">
                <BotaoPainel
                  variante="sutil"
                  disabled={testando || (!config.temWebhook && !webhook.trim())}
                  onClick={() =>
                    testar(async () =>
                      setRespostaTeste(await enviarTeste({ webhookUrl: webhook.trim() })),
                    )
                  }
                >
                  {testando ? "Enviando…" : "Enviar mensagem de teste"}
                </BotaoPainel>
                {config.temWebhook && tabelaPronta ? (
                  <AcaoProtegida
                    rotulo="Remover webhook"
                    titulo="Remover o webhook?"
                    descricao="O endereço é apagado e o canal desliga. Para voltar a receber, é preciso colar um webhook de novo."
                    confirmar="Remover"
                    variante="fantasma"
                    perigo
                    acao={() => removerWebhook()}
                  />
                ) : null}
                <Retorno valor={respostaTeste} />
              </div>
            ) : null}
          </div>
        </Bloco>

        <Bloco
          titulo="Avisar na hora"
          descricao="Cada caixa marcada vira uma mensagem no momento em que acontece. Várias ao mesmo tempo chegam juntas numa postagem só."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {LISTA_DE_EVENTOS.map((tipo) => {
              const marcado = eventos.has(tipo);
              return (
                <label
                  key={tipo}
                  className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors ${
                    marcado
                      ? "border-[var(--color-rose-500)]/40 bg-[var(--p-acento-suave)]"
                      : "border-[var(--p-linha)] hover:bg-white/4"
                  } ${bloqueado ? "cursor-default" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={bloqueado}
                    onChange={() => alternarEvento(tipo)}
                    className="mt-0.5 accent-[var(--color-rose-600)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-[var(--p-texto)]">
                      {TIPOS_DE_EVENTO[tipo].rotulo}
                    </span>
                    <span className="block text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
                      {TIPOS_DE_EVENTO[tipo].descricao}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </Bloco>

        <Bloco
          titulo="Relatório periódico"
          descricao="O fechamento de uma janela que já terminou, comparado com a janela anterior. Cada janela sai uma vez só."
          acao={
            <Chave
              ligado={relatorioAtivo}
              onChange={(v) => {
                setRelatorioAtivo(v);
                setAba("relatorio");
              }}
              rotulo="Relatório periódico"
              desabilitado={bloqueado}
            />
          }
        >
          <div
            className={`grid gap-3 sm:grid-cols-2 ${relatorioAtivo ? "" : "opacity-50"}`}
          >
            <label className="block">
              <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
                Frequência
              </span>
              <select
                value={intervalo}
                disabled={bloqueado}
                onChange={(e) => {
                  setIntervalo(e.target.value as Intervalo);
                  setAba("relatorio");
                }}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)] focus:border-[var(--p-acento)] focus:outline-none"
              >
                {(Object.keys(INTERVALOS) as Intervalo[]).map((chave) => (
                  <option key={chave} value={chave}>
                    {INTERVALOS[chave].rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[0.6875rem] font-semibold tracking-wide text-[var(--p-fraco)] uppercase">
                {intervalo === "1h" ? "Alinhado à hora cheia" : "Horário de fechamento"}
              </span>
              <select
                value={hora}
                disabled={bloqueado || intervalo === "1h"}
                onChange={(e) => {
                  setHora(Number(e.target.value));
                  setAba("relatorio");
                }}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)] focus:border-[var(--p-acento)] focus:outline-none disabled:opacity-60"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hora2(h)} (Brasília)
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--p-fraco)]">
            Próximo relatório: <strong className="text-[var(--p-suave)]">{fmtProximo.format(proximo)}</strong>.
            {" "}Com o agente do servidor de mídia ligado, sai em até um minuto
            depois do fechamento. Sem ele, o agendador diário garante a entrega
            uma vez por dia.
          </p>
        </Bloco>

        {podeGerenciar ? (
          <div className="flex flex-wrap items-center gap-3">
            <BotaoPainel
              variante="principal"
              onClick={enviar}
              disabled={salvando || !tabelaPronta || !alterado}
            >
              {salvando ? "Salvando…" : "Salvar"}
            </BotaoPainel>
            <BotaoPainel
              variante="fantasma"
              disabled={verificando || !tabelaPronta || !config.ativo}
              title="Envia agora o que estiver pendente, sem esperar o próximo minuto"
              onClick={() =>
                verificar(async () => setResposta(await verificarAgora()))
              }
            >
              {verificando ? "Verificando…" : "Enviar pendentes agora"}
            </BotaoPainel>
            {alterado && !resposta ? (
              <span className="text-[0.75rem] text-[var(--p-atencao)]">
                alterações não salvas
              </span>
            ) : null}
            <Retorno valor={resposta} />
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------- o que vai chegar */}
      <div className="min-w-0 xl:sticky xl:top-24">
        <Bloco
          titulo="Como chega no Discord"
          descricao={
            aba === "relatorio"
              ? refazendo
                ? "Refazendo com os números da janela escolhida…"
                : "Números reais da última janela fechada"
              : exemploDaAba?.real
                ? "O último caso real deste tipo"
                : "Exemplo — ainda não aconteceu nenhum deste tipo"
          }
          compacto
        >
          <div
            role="tablist"
            aria-label="Tipo de mensagem"
            className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1"
          >
            {(["relatorio", ...LISTA_DE_EVENTOS] as const).map((chave) => {
              const atual = aba === chave;
              const ligadoAqui =
                chave === "relatorio" ? relatorioAtivo : eventos.has(chave);
              return (
                <button
                  key={chave}
                  type="button"
                  role="tab"
                  aria-selected={atual}
                  onClick={() => setAba(chave)}
                  className={`h-7 shrink-0 rounded-md px-2.5 text-[0.75rem] whitespace-nowrap transition-colors ${
                    atual
                      ? "bg-white/10 text-[var(--p-texto)]"
                      : "text-[var(--p-fraco)] hover:bg-white/5 hover:text-[var(--p-suave)]"
                  } ${ligadoAqui ? "" : "line-through decoration-white/25"}`}
                  title={ligadoAqui ? undefined : "Desmarcado — não será enviado"}
                >
                  {chave === "relatorio" ? "Relatório" : TIPOS_DE_EVENTO[chave].rotulo}
                </button>
              );
            })}
          </div>

          {mensagemDaAba ? (
            <div className={refazendo && aba === "relatorio" ? "opacity-60 transition-opacity" : ""}>
              <PreviaDiscord mensagem={mensagemDaAba} />
            </div>
          ) : null}
        </Bloco>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ a prévia

/**
 * O pedaço de markdown que as mensagens usam: **negrito**, quebras de linha
 * e caracteres escapados. Nada além — o formatador não produz outra coisa.
 */
function Md({ texto }: { texto: string }) {
  const partes: { texto: string; negrito: boolean }[] = [];
  let atual = "";
  let negrito = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === "\\" && i + 1 < texto.length) {
      atual += texto[i + 1];
      i += 1;
    } else if (c === "*" && texto[i + 1] === "*") {
      partes.push({ texto: atual, negrito });
      atual = "";
      negrito = !negrito;
      i += 1;
    } else {
      atual += c;
    }
  }
  partes.push({ texto: atual, negrito });

  return (
    <>
      {partes.map((p, i) =>
        p.negrito ? (
          <strong key={i} className="font-semibold text-white">
            {p.texto}
          </strong>
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </>
  );
}

const fmtCarimbo = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function Embed({ embed }: { embed: EmbedDiscord }) {
  const cor = `#${(embed.color ?? 0x4e5058).toString(16).padStart(6, "0")}`;
  const campos = embed.fields ?? [];

  return (
    <div
      className="mt-1.5 max-w-[32rem] rounded-[4px] border-l-4 bg-[#2b2d31] py-2.5 pr-4 pl-3"
      style={{ borderLeftColor: cor }}
    >
      {embed.author ? (
        <p className="text-[0.75rem] font-semibold text-white">{embed.author.name}</p>
      ) : null}
      {embed.title ? (
        <p
          className={`mt-1 text-[0.9375rem] font-semibold break-words ${
            embed.url ? "text-[#00a8fc]" : "text-white"
          }`}
        >
          {embed.title}
        </p>
      ) : null}
      {embed.description ? (
        <p className="mt-1 text-[0.8125rem] leading-[1.35rem] break-words whitespace-pre-line text-[#dbdee1]">
          <Md texto={embed.description} />
        </p>
      ) : null}
      {campos.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2">
          {campos.map((campo, i) => (
            <div key={`${campo.name}-${i}`} className={campo.inline ? "min-w-0" : "col-span-3 min-w-0"}>
              <p className="text-[0.75rem] font-semibold text-white">{campo.name}</p>
              <p className="text-[0.8125rem] leading-[1.3rem] break-words whitespace-pre-line text-[#dbdee1]">
                <Md texto={campo.value} />
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {embed.footer || embed.timestamp ? (
        <p className="mt-2 text-[0.6875rem] text-[#949ba4]">
          {embed.footer?.text}
          {embed.footer && embed.timestamp ? " • " : ""}
          {embed.timestamp ? fmtCarimbo.format(new Date(embed.timestamp)) : ""}
        </p>
      ) : null}
    </div>
  );
}

export function PreviaDiscord({ mensagem }: { mensagem: MensagemDiscord }) {
  return (
    <div
      className="overflow-hidden rounded-lg bg-[#313338] px-4 py-3 text-[#dbdee1]"
      style={{ fontFamily: '"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif' }}
    >
      <div className="flex gap-3">
        <div
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e11d74] text-[0.9375rem] font-bold text-white"
        >
          N
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 leading-tight">
            <span className="text-[0.9375rem] font-medium text-white">{mensagem.username}</span>
            <span className="rounded-[3px] bg-[#5865f2] px-1 py-px text-[0.625rem] font-semibold text-white">
              APP
            </span>
            <span className="text-[0.6875rem] text-[#949ba4]">agora</span>
          </p>
          {mensagem.content ? (
            <p className="mt-0.5 text-[0.9375rem]">
              <Md texto={mensagem.content} />
            </p>
          ) : null}
          {mensagem.embeds.map((embed, i) => (
            <Embed key={i} embed={embed} />
          ))}
        </div>
      </div>
    </div>
  );
}
