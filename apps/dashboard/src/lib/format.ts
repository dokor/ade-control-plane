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

export function formatPercent(value: number | null): string {
  // The provider may not expose a percentage; never invent one.
  return value === null ? "not reported" : `${Math.round(value)}%`;
}
