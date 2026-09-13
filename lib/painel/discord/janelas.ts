import {
  chaveDoDia,
  instanteDoFuso,
  partesNoFuso,
  somarDias,
} from "@/lib/painel/tempo";

/**
 * Janelas do relatório periódico.
 *
 * O relatório não é "os números de agora": é o fechamento de uma janela que
 * já terminou. Isso resolve as duas exigências de uma vez —
 *
 * - **não repetir**: cada janela tem uma chave estável, e a mesma chave nunca
 *   é enviada duas vezes (a trava mora no banco, em `DiscordEntrega.chave`);
 * - **não depender de relógio pontual**: o agendador pode passar às 8h00 ou às
 *   8h07 — a janela fechada às 8h é a mesma, e quem chegar primeiro envia.
 *
 * Tudo no fuso de Brasília (ver `lib/painel/tempo.ts`): "o relatório das 8h"
 * é das 8h de São Paulo, não das 8h UTC.
 */

export const INTERVALOS = {
  "1h": { rotulo: "De hora em hora", horas: 1 },
  "6h": { rotulo: "A cada 6 horas", horas: 6 },
  "12h": { rotulo: "A cada 12 horas", horas: 12 },
  diario: { rotulo: "Uma vez por dia", horas: 24 },
  semanal: { rotulo: "Uma vez por semana (segunda)", horas: 168 },
} as const;

export type Intervalo = keyof typeof INTERVALOS;

export function ehIntervalo(valor: unknown): valor is Intervalo {
  return typeof valor === "string" && valor in INTERVALOS;
}

export type Janela = {
  /** Estável por janela: a trava contra envio repetido. */
  chave: string;
  inicio: Date;
  /** Exclusivo, como em todo o painel: `inicio <= t < fim`. */
  fim: Date;
};

const HORA_MS = 3_600_000;

function chaveDaJanela(intervalo: Intervalo, inicio: Date): string {
  const hora = String(partesNoFuso(inicio).hora).padStart(2, "0");
  return `${intervalo}:${chaveDoDia(inicio)}T${hora}`;
}

/** A virada de `hora` mais recente que não está no futuro. */
function ultimaVirada(hora: number, agora: Date): Date {
  const p = partesNoFuso(agora);
  const hoje = instanteDoFuso(p.ano, p.mes, p.dia, hora);
  return hoje <= agora ? hoje : somarDias(hoje, -1);
}

/**
 * A janela mais recente que já fechou.
 *
 * Intervalos menores que um dia se alinham à hora escolhida: com 6 h e
 * virada às 8h, as janelas fecham às 2h, 8h, 14h e 20h — previsível para quem
 * lê o canal, em vez de derivar do minuto em que alguém salvou a tela.
 */
export function ultimaJanelaFechada(
  intervalo: Intervalo,
  hora: number,
  agora: Date = new Date(),
): Janela {
  const horaValida = Math.min(23, Math.max(0, Math.trunc(hora)));

  if (intervalo === "diario") {
    const fim = ultimaVirada(horaValida, agora);
    const inicio = somarDias(fim, -1);
    return { chave: chaveDaJanela(intervalo, inicio), inicio, fim };
  }

  if (intervalo === "semanal") {
    let fim = ultimaVirada(horaValida, agora);
    // Recua até a segunda-feira. getUTCDay de uma data montada com os campos
    // locais dá o dia da semana local, sem depender do fuso da máquina.
    for (let i = 0; i < 7; i += 1) {
      const p = partesNoFuso(fim);
      if (new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay() === 1) break;
      fim = somarDias(fim, -1);
    }
    const inicio = somarDias(fim, -7);
    return { chave: chaveDaJanela(intervalo, inicio), inicio, fim };
  }

  const passo = INTERVALOS[intervalo].horas * HORA_MS;
  const base = ultimaVirada(horaValida, agora);
  const passos = Math.floor((agora.getTime() - base.getTime()) / passo);
  const fim = new Date(base.getTime() + passos * passo);
  const inicio = new Date(fim.getTime() - passo);
  return { chave: chaveDaJanela(intervalo, inicio), inicio, fim };
}

/** Quando a próxima janela fecha — é quando o próximo relatório sai. */
export function proximoFechamento(
  intervalo: Intervalo,
  hora: number,
  agora: Date = new Date(),
): Date {
  const atual = ultimaJanelaFechada(intervalo, hora, agora);
  if (intervalo === "diario") return somarDias(atual.fim, 1);
  if (intervalo === "semanal") return somarDias(atual.fim, 7);
  return new Date(atual.fim.getTime() + INTERVALOS[intervalo].horas * HORA_MS);
}
