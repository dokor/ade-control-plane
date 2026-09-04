const FRENCH_TIME_ZONE = "Europe/Paris";

const FRENCH_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: FRENCH_TIME_ZONE,
});

const FRENCH_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: FRENCH_TIME_ZONE,
});

const FRENCH_HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: FRENCH_TIME_ZONE,
});

export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function formatInstant(value: string | null): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : FRENCH_DATE_TIME_FORMATTER.format(new Date(parsed));
}

export function formatFutureDistance(value: string | null, now = Date.now()): string {
  if (!value) return "unknown";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || Number.isNaN(now)) return "unknown";

  const remainingMs = parsed - now;
  if (remainingMs <= 0) return "maintenant";

  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes === 0) return "dans moins d’1 min";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `dans ${minutes} min`;
  if (minutes === 0) return `dans ${hours} h`;
  return `dans ${hours} h ${minutes} min`;
}

export function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
  now = Date.now(),
): string {
  if (!startedAt) return "not started";
  const started = Date.parse(startedAt);
  const finished = finishedAt ? Date.parse(finishedAt) : now;
  if (Number.isNaN(started) || Number.isNaN(finished)) return "unknown";
  const seconds = Math.max(0, Math.floor((finished - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatHistoryDate(value: string | null, now = Date.now()): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "unknown";

  const ageSeconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (ageSeconds < 45) return "à l’instant";
  if (ageSeconds < 3_600) return `il y a ${Math.floor(ageSeconds / 60)} min`;
  if (ageSeconds < 86_400) return `il y a ${Math.floor(ageSeconds / 3_600)} h`;
  if (ageSeconds < 172_800) {
    return `hier à ${FRENCH_TIME_FORMATTER.format(new Date(parsed))}`;
  }
  return FRENCH_HISTORY_DATE_FORMATTER.format(new Date(parsed));
}

export function formatPercent(value: number | null): string {
  // The provider may not expose a percentage; never invent one.
  return value === null ? "not reported" : `${Math.round(value)}%`;
}
