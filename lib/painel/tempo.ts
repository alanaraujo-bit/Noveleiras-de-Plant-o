/**
 * Tempo do painel.
 *
 * Uma operação brasileira lê "hoje" como o dia de Brasília, não o dia UTC.
 * Entre 21h e 0h (horário de São Paulo) o UTC já virou — sem este módulo,
 * "hoje" mostraria três horas do dia seguinte e o gráfico diário teria degraus
 * em lugares que ninguém consegue explicar.
 *
 * Toda janela de tempo do painel nasce aqui. As consultas usam
 * `"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'` porque as
 * colunas são `timestamp without time zone` guardando UTC.
 */

export const FUSO = "America/Sao_Paulo";

/** Expressão SQL que traz uma coluna UTC para o fuso da operação. */
export function noFuso(coluna: string): string {
  return `"${coluna}" AT TIME ZONE 'UTC' AT TIME ZONE '${FUSO}'`;
}

const formatador = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Partes = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

export function partesNoFuso(instante: Date): Partes {
  const p = Object.fromEntries(
    formatador.formatToParts(instante).map((parte) => [parte.type, parte.value]),
  ) as Record<string, string>;
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    // Meia-noite sai como "24" em algumas plataformas.
    hora: Number(p.hour) % 24,
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

function deslocamentoMs(instante: Date): number {
  const p = partesNoFuso(instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - instante.getTime();
}

/** Converte uma data-hora local de São Paulo no instante UTC correspondente. */
export function instanteDoFuso(
  ano: number,
  mes: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
): Date {
  const chute = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  // Duas passadas resolvem a virada de horário de verão, caso ele volte.
  let deslocamento = deslocamentoMs(new Date(chute));
  deslocamento = deslocamentoMs(new Date(chute - deslocamento));
  return new Date(chute - deslocamento);
}

/** Meia-noite (no fuso) do dia em que o instante cai. */
export function inicioDoDia(instante: Date): Date {
  const p = partesNoFuso(instante);
  return instanteDoFuso(p.ano, p.mes, p.dia);
}

export function somarDias(instante: Date, dias: number): Date {
  const p = partesNoFuso(instante);
  return instanteDoFuso(p.ano, p.mes, p.dia + dias, p.hora, p.minuto, p.segundo);
}

/** "2026-09-07" no fuso da operação — chave estável para agrupar por dia. */
export function chaveDoDia(instante: Date): string {
  const p = partesNoFuso(instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

// ------------------------------------------------------------- períodos

export const PERIODOS = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  "12m": "12 meses",
} as const;

export type ChavePeriodo = keyof typeof PERIODOS | "personalizado";

/** Passo do eixo do tempo. Escolhido pela janela, não pelo gosto do gráfico. */
export type Granularidade = "hora" | "dia" | "semana" | "mes";

export type Periodo = {
  chave: ChavePeriodo;
  rotulo: string;
  inicio: Date;
  /** Exclusivo: sempre `inicio <= t < fim`. */
  fim: Date;
  granularidade: Granularidade;
  /** Janela imediatamente anterior, de mesma duração, para comparação. */
  anterior: { inicio: Date; fim: Date };
};

function granularidadePara(inicio: Date, fim: Date): Granularidade {
  const dias = (fim.getTime() - inicio.getTime()) / 86_400_000;
  if (dias <= 2) return "hora";
  if (dias <= 62) return "dia";
  if (dias <= 200) return "semana";
  return "mes";
}

function comAnterior(
  chave: ChavePeriodo,
  rotulo: string,
  inicio: Date,
  fim: Date,
): Periodo {
  const duracao = fim.getTime() - inicio.getTime();
  return {
    chave,
    rotulo,
    inicio,
    fim,
    granularidade: granularidadePara(inicio, fim),
    anterior: { inicio: new Date(inicio.getTime() - duracao), fim: inicio },
  };
}

/**
 * Resolve a janela pedida. `agora` é injetável para que os testes não dependam
 * do relógio da máquina.
 */
export function resolverPeriodo(
  chave: string | undefined | null,
  opcoes?: { de?: string | null; ate?: string | null; agora?: Date },
): Periodo {
  const agora = opcoes?.agora ?? new Date();
  const hoje = inicioDoDia(agora);
  const amanha = somarDias(hoje, 1);

  if (chave === "personalizado" && opcoes?.de && opcoes?.ate) {
    const [ai, mi, di] = opcoes.de.split("-").map(Number);
    const [af, mf, df] = opcoes.ate.split("-").map(Number);
    if (ai && mi && di && af && mf && df) {
      const inicio = instanteDoFuso(ai, mi, di);
      // `ate` é inclusivo para quem escolhe no calendário; vira exclusivo aqui.
      const fim = instanteDoFuso(af, mf, df + 1);
      if (fim > inicio) {
        return comAnterior(
          "personalizado",
          `${opcoes.de} a ${opcoes.ate}`,
          inicio,
          fim,
        );
      }
    }
  }

  switch (chave) {
    case "hoje":
      return comAnterior("hoje", "Hoje", hoje, amanha);
    case "ontem": {
      const ontem = somarDias(hoje, -1);
      return comAnterior("ontem", "Ontem", ontem, hoje);
    }
    case "90d":
      return comAnterior("90d", "90 dias", somarDias(hoje, -89), amanha);
    case "12m":
      return comAnterior("12m", "12 meses", somarDias(hoje, -364), amanha);
    case "7d":
      return comAnterior("7d", "7 dias", somarDias(hoje, -6), amanha);
    case "30d":
    default:
      return comAnterior("30d", "30 dias", somarDias(hoje, -29), amanha);
  }
}

/**
 * Sequência de baldes vazios do período. Existe para que um dia sem nada vire
 * um zero no gráfico em vez de sumir — buraco no eixo mente sobre a forma da
 * curva.
 */
export function baldesDoPeriodo(periodo: Periodo): { chave: string; inicio: Date }[] {
  const baldes: { chave: string; inicio: Date }[] = [];
  const { granularidade } = periodo;

  if (granularidade === "hora") {
    for (let t = periodo.inicio.getTime(); t < periodo.fim.getTime(); t += 3_600_000) {
      const instante = new Date(t);
      const p = partesNoFuso(instante);
      baldes.push({
        chave: `${chaveDoDia(instante)}T${String(p.hora).padStart(2, "0")}`,
        inicio: instante,
      });
    }
    return baldes;
  }

  const passo = granularidade === "semana" ? 7 : 1;
  let cursor = periodo.inicio;
  if (granularidade === "mes") {
    const p = partesNoFuso(periodo.inicio);
    cursor = instanteDoFuso(p.ano, p.mes, 1);
    while (cursor < periodo.fim) {
      const q = partesNoFuso(cursor);
      baldes.push({
        chave: `${q.ano}-${String(q.mes).padStart(2, "0")}`,
        inicio: cursor,
      });
      cursor = instanteDoFuso(q.ano, q.mes + 1, 1);
    }
    return baldes;
  }

  while (cursor < periodo.fim) {
    baldes.push({ chave: chaveDoDia(cursor), inicio: cursor });
    cursor = somarDias(cursor, passo);
  }
  return baldes;
}

/** `date_trunc` correspondente à granularidade, já no fuso da operação. */
export function truncSql(granularidade: Granularidade, coluna: string): string {
  const unidade =
    granularidade === "hora"
      ? "hour"
      : granularidade === "semana"
        ? "week"
        : granularidade === "mes"
          ? "month"
          : "day";
  return `date_trunc('${unidade}', ${noFuso(coluna)})`;
}

/** Chave de balde a partir de uma data já truncada pelo Postgres (local). */
export function chaveDoBalde(
  granularidade: Granularidade,
  local: Date,
): string {
  // O Postgres devolve o resultado de AT TIME ZONE como timestamp sem fuso; o
  // driver o entrega como se fosse UTC, então lemos os campos em UTC.
  const ano = local.getUTCFullYear();
  const mes = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(local.getUTCDate()).padStart(2, "0");
  if (granularidade === "mes") return `${ano}-${mes}`;
  if (granularidade === "hora") {
    return `${ano}-${mes}-${dia}T${String(local.getUTCHours()).padStart(2, "0")}`;
  }
  return `${ano}-${mes}-${dia}`;
}

/**
 * O recorte de tempo como sufixo de URL.
 *
 * Descer um nível de investigação nunca pode reabrir o período padrão: quem
 * abriu "últimos 90 dias" e clicou numa linha continua nos mesmos 90 dias.
 */
export function sufixoDoPeriodo(
  params: Record<string, string | undefined>,
): string {
  const busca = new URLSearchParams();
  for (const chave of ["periodo", "de", "ate"] as const) {
    const valor = params[chave];
    if (valor) busca.set(chave, valor);
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : "";
}
