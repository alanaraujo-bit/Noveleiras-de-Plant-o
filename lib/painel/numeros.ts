/**
 * Formatação e comparação de números do painel.
 *
 * Regra que atravessa o arquivo: um número sozinho não decide nada. "1.240
 * reproduções" só vira informação ao lado de "eram 890 no período anterior".
 * Por isso o tipo central é `Indicador`, não `number`.
 */

export type Indicador = {
  valor: number;
  /** Mesmo recorte na janela anterior. `null` quando não faz sentido comparar. */
  anterior: number | null;
  /** Variação relativa (0.12 = +12%). `null` quando o anterior era zero. */
  variacao: number | null;
  /** Diferença absoluta. */
  diferenca: number | null;
};

export function indicador(valor: number, anterior: number | null): Indicador {
  if (anterior === null) {
    return { valor, anterior: null, variacao: null, diferenca: null };
  }
  const diferenca = valor - anterior;
  // Crescer a partir de zero não é "infinito por cento": é um começo, e o
  // painel mostra a diferença absoluta em vez de um percentual sem sentido.
  const variacao = anterior === 0 ? null : diferenca / anterior;
  return { valor, anterior, variacao, diferenca };
}

const numero = new Intl.NumberFormat("pt-BR");
const numeroCurto = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const moedaCurta = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function fmtNumero(valor: number): string {
  return numero.format(Math.round(valor));
}

export function fmtCompacto(valor: number): string {
  if (Math.abs(valor) < 10_000) return numero.format(Math.round(valor));
  return numeroCurto.format(valor);
}

export function fmtMoeda(cents: number): string {
  return moeda.format(cents / 100);
}

export function fmtMoedaCurta(cents: number): string {
  if (Math.abs(cents) < 1_000_000) return moeda.format(cents / 100);
  return moedaCurta.format(cents / 100);
}

export function fmtPercentual(fracao: number, casas = 1): string {
  return `${(fracao * 100).toFixed(casas).replace(".", ",")}%`;
}

export function fmtVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : "";
  const casas = Math.abs(variacao) >= 1 ? 0 : 1;
  return `${sinal}${(variacao * 100).toFixed(casas).replace(".", ",")}%`;
}

/**
 * Duração legível a partir de milissegundos. Some as unidades irrelevantes:
 * "3 h 12 min" e não "3 h 12 min 07 s" — precisão que ninguém usa é ruído.
 */
export function fmtDuracao(ms: number): string {
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos}s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  const dias = Math.floor(horas / 24);
  const horasResto = horas % 24;
  return horasResto === 0 ? `${dias} d` : `${dias} d ${horasResto} h`;
}

/** Relógio de posição dentro de um episódio: 4:07. */
export function fmtRelogio(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(valor < 10 ? 1 : 0).replace(".", ",")} ${unidades[i]}`;
}

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
});

const horaCurta = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDataHora(data: Date | string | null | undefined): string {
  if (!data) return "—";
  return dataHora.format(typeof data === "string" ? new Date(data) : data);
}

export function fmtDataCurta(data: Date | string): string {
  return dataCurta.format(typeof data === "string" ? new Date(data) : data);
}

/**
 * Formata uma chave de dia ("2026-09-07") — que já é uma data local, não um
 * instante.
 *
 * Passá-la por `new Date()` a lê como meia-noite **UTC**; o formatador então a
 * converte para Brasília e imprime o dia anterior. Foi assim que a coorte da
 * semana de 07/09 apareceu como "06 de set." A correção é não envolver fuso
 * nenhum: os números já vêm no calendário certo.
 */
const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

export function fmtDiaDaChave(chave: string): string {
  const [, mes, dia] = chave.split("-");
  if (!mes || !dia) return chave;
  return `${dia} de ${MESES[Number(mes) - 1] ?? mes}`;
}

export function fmtHora(data: Date | string): string {
  return horaCurta.format(typeof data === "string" ? new Date(data) : data);
}

/** "há 3 min", "há 2 h". Para "última comunicação" e listas de atividade. */
export function fmtDesde(data: Date | string | null | undefined): string {
  if (!data) return "nunca";
  const instante = typeof data === "string" ? new Date(data) : data;
  const diff = Date.now() - instante.getTime();
  if (diff < 0) return "agora";
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  const dias = Math.floor(diff / 86_400_000);
  if (dias < 31) return `há ${dias} d`;
  return fmtDataCurta(instante);
}

/**
 * Rótulo curto de um balde do eixo do tempo. Recebe a chave produzida em
 * `tempo.ts` — nunca uma Date, para não reintroduzir fuso na apresentação.
 */
export function rotuloDoBalde(chave: string): string {
  if (chave.includes("T")) {
    const [, hora] = chave.split("T");
    return `${hora}h`;
  }
  const partes = chave.split("-");
  if (partes.length === 2) {
    const [ano, mes] = partes;
    const nomes = [
      "jan", "fev", "mar", "abr", "mai", "jun",
      "jul", "ago", "set", "out", "nov", "dez",
    ];
    return `${nomes[Number(mes) - 1]}/${ano.slice(2)}`;
  }
  const [, mes, dia] = partes;
  return `${dia}/${mes}`;
}

/**
 * Direção de uma variação para efeito de cor. Nem toda subida é boa: churn
 * subindo é ruim, e pintar de verde seria mentir com cor.
 */
export type Sentido = "maior-melhor" | "menor-melhor" | "neutro";

export function tomDaVariacao(
  variacao: number | null,
  sentido: Sentido = "maior-melhor",
): "bom" | "ruim" | "neutro" {
  if (variacao === null || variacao === 0 || sentido === "neutro") return "neutro";
  const subiu = variacao > 0;
  if (sentido === "maior-melhor") return subiu ? "bom" : "ruim";
  return subiu ? "ruim" : "bom";
}
