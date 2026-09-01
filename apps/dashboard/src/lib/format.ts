export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatInstant(value: string | null): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function formatHistoryDate(value: string | null, now = Date.now()): string {
  if (!value) return "never";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "unknown";

  const ageSeconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (ageSeconds < 45) return "just now";
  if (ageSeconds < 3_600) return `${Math.floor(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3_600)} hr ago`;
  if (ageSeconds < 172_800) {
    return `yesterday at ${new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(parsed))}`;
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

export function formatPercent(value: number | null): string {
  // The provider may not expose a percentage; never invent one.
  return value === null ? "not reported" : `${Math.round(value)}%`;
}
