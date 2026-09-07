/** Formatação em português do Brasil. */

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes} min ${String(rest).padStart(2, "0")}s`;
}

/** Relógio do player: 1:07 / 12:04. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

const RELATIVE_STEPS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60_000, "minute"],
  [3_600_000, "hour"],
  [86_400_000, "day"],
  [604_800_000, "week"],
];

export function formatRelative(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : date0(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "agora";

  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let divisor = 60_000;
  for (const [step, stepUnit] of RELATIVE_STEPS) {
    if (diff >= step) {
      divisor = step;
      unit = stepUnit;
    }
  }
  if (diff >= 2_592_000_000) {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
    }).format(date);
  }
  return formatter.format(-Math.round(diff / divisor), unit);
}

function date0(value: Date): Date {
  return value;
}

export function formatDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k.toFixed(k < 10 ? 1 : 0).replace(".", ",")} mil`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(".", ",")} mi`;
}

export function formatRating(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

export const STATUS_LABEL = {
  ONGOING: "Em exibição",
  COMPLETED: "Novela completa",
  COMING_SOON: "Em breve",
} as const;

export function episodeLabel(season: number, episode: number): string {
  return `T${season} · Ep. ${episode}`;
}
