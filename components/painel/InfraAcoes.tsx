"use client";

import { useState, useTransition } from "react";

import { AcaoProtegida } from "@/components/painel/AcaoProtegida";
import { BotaoPainel } from "@/components/painel/primitivos";
import { decidirAlerta, reavaliarAlertas } from "@/lib/painel/acoes/alertas";
import {
  cancelarTrabalho,
  enfileirarTranscodificacao,
  reenfileirarTrabalho,
} from "@/lib/painel/acoes/transcodificacao";

/**
 * Controles de infraestrutura.
 *
 * Cliente porque cada botão fecha sobre o seu alvo. `pode*` decide apenas o
 * que aparece — cada ação reconfere a permissão no servidor por conta própria.
 */

function Resposta({
  valor,
}: {
  valor: { ok: true; mensagem: string } | { ok: false; erro: string } | null;
}) {
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

export function AcoesDoAlerta({
  alertaId,
  situacao,
  podeGerenciar,
}: {
  alertaId: string;
  situacao: string;
  podeGerenciar: boolean;
}) {
  if (!podeGerenciar) return null;

  if (situacao === "RESOLVED") {
    return (
      <AcaoProtegida
        rotulo="Reabrir"
        titulo="Devolver este alerta para a fila?"
        descricao="Use quando o problema não estava resolvido de fato. Se a condição já não vale, a próxima avaliação o fecha de novo sozinha."
        confirmar="Reabrir"
        variante="fantasma"
        acao={(motivo) => decidirAlerta({ alertaId, decisao: "OPEN", motivo })}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {situacao === "OPEN" ? (
        <AcaoProtegida
          rotulo="Reconhecer"
          titulo="Reconhecer este alerta?"
          descricao="Sinaliza para o resto da equipe que alguém já está olhando. Não resolve nada — o alerta continua na fila até a condição deixar de valer ou alguém encerrá-lo."
          confirmar="Reconhecer"
          variante="fantasma"
          acao={(motivo) =>
            decidirAlerta({ alertaId, decisao: "ACKNOWLEDGED", motivo })
          }
        />
      ) : null}
      <AcaoProtegida
        rotulo="Resolver"
        titulo="Marcar como resolvido?"
        descricao="Use quando a causa foi tratada. Se a condição ainda valer, a próxima avaliação reabre o alerta — a fila reflete a realidade, não o otimismo de quem a limpou."
        confirmar="Resolver"
        variante="sutil"
        pedirMotivo
        acao={(motivo) =>
          decidirAlerta({ alertaId, decisao: "RESOLVED", motivo })
        }
      />
    </div>
  );
}

export function ReavaliarAgora({ podeGerenciar }: { podeGerenciar: boolean }) {
  const [resposta, setResposta] = useState<
    { ok: true; mensagem: string } | { ok: false; erro: string } | null
  >(null);
  const [pendente, iniciar] = useTransition();

  if (!podeGerenciar) return null;

  return (
    <span className="flex flex-wrap items-center gap-2.5">
      <BotaoPainel
        variante="sutil"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => setResposta(await reavaliarAlertas()))
        }
      >
        {pendente ? "Avaliando…" : "Avaliar agora"}
      </BotaoPainel>
      <Resposta valor={resposta} />
    </span>
  );
}

const PERFIS = [
  { valor: "720p" as const, rotulo: "720p", nota: "metade da banda" },
  { valor: "480p" as const, rotulo: "480p", nota: "para conexão ruim" },
  { valor: "hls" as const, rotulo: "HLS", nota: "troca de qualidade ao vivo" },
];

export function EnfileirarPerfil({
  assetIds,
  podeGerenciar,
}: {
  assetIds: string[];
  podeGerenciar: boolean;
}) {
  const [perfil, setPerfil] = useState<"720p" | "480p" | "hls">("720p");
  const [resposta, setResposta] = useState<
    { ok: true; mensagem: string } | { ok: false; erro: string } | null
  >(null);
  const [pendente, iniciar] = useTransition();

  if (!podeGerenciar || assetIds.length === 0) return null;

  const escolhido = PERFIS.find((p) => p.valor === perfil)!;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Perfil de saída</span>
        <select
          value={perfil}
          onChange={(evento) => setPerfil(evento.target.value as typeof perfil)}
          className="h-8 rounded-lg border border-[var(--p-linha)] bg-[var(--p-superficie)] px-2 text-[0.8125rem] text-[var(--p-texto)] focus:border-[var(--p-acento)] focus:outline-none"
        >
          {PERFIS.map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>
              {opcao.rotulo} — {opcao.nota}
            </option>
          ))}
        </select>
      </label>
      <BotaoPainel
        variante="principal"
        disabled={pendente}
        onClick={() =>
          iniciar(async () =>
            setResposta(await enfileirarTranscodificacao({ assetIds, perfil })),
          )
        }
      >
        {pendente
          ? "Enfileirando…"
          : `Enfileirar ${assetIds.length} em ${escolhido.rotulo}`}
      </BotaoPainel>
      <Resposta valor={resposta} />
    </div>
  );
}

export function AcoesDoTrabalho({
  jobId,
  situacao,
  podeGerenciar,
}: {
  jobId: string;
  situacao: string;
  podeGerenciar: boolean;
}) {
  if (!podeGerenciar) return null;

  if (situacao === "QUEUED" || situacao === "RUNNING") {
    return (
      <AcaoProtegida
        rotulo="Cancelar"
        titulo="Cancelar este trabalho?"
        descricao={
          situacao === "RUNNING"
            ? "O agente encerra o ffmpeg na próxima verificação de progresso, em até um segundo. O arquivo parcial é descartado."
            : "O trabalho sai da fila sem ter começado."
        }
        confirmar="Cancelar trabalho"
        variante="perigo"
        perigo
        pedirMotivo
        acao={(motivo) => cancelarTrabalho({ jobId, motivo })}
      />
    );
  }

  if (situacao === "FAILED" || situacao === "CANCELED") {
    return (
      <AcaoProtegida
        rotulo="Reenfileirar"
        titulo="Colocar de volta na fila?"
        descricao="O trabalho recomeça do zero. A contagem de tentativas não zera — é ela que diz se o problema é intermitente ou permanente."
        confirmar="Reenfileirar"
        variante="sutil"
        acao={(motivo) => reenfileirarTrabalho({ jobId, motivo })}
      />
    );
  }

  return null;
}
