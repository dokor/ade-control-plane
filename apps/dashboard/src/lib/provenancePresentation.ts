const ACRONYMS: Readonly<Record<string, string>> = {
  ade: "ADE",
  ai: "AI",
  api: "API",
  id: "ID",
  ids: "IDs",
  sha: "SHA",
};

export function formatProvenanceKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.toLowerCase());

  return words.length > 0 ? words.join(" ") : key;
}
