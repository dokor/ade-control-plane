/**
 * Outbound redaction for anything the control plane writes back to GitHub.
 *
 * The Dashboard sanitizes on its own egress; this is the second, independent
 * guard on the GitHub boundary, so a bot comment cannot leak a credential even
 * if an upstream caller forgets to sanitize.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{10,}/g, "[redacted-token]"],
  [/\bsk-[A-Za-z0-9-_]{10,}/g, "[redacted-token]"],
  [/\b(?:eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, "[redacted-token]"],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, "[redacted-env]"],
  [/postgres(?:ql)?:\/\/\S+/gi, "[redacted-dsn]"],
  [/(?:\/(?:home|root|run|etc|var|proc|Users)|[A-Za-z]:\\)[^\s"']*/g, "[redacted-path]"],
  [/\b(?:password|secret|token|authorization)\b\s*[:=]\s*\S+/gi, "[redacted-secret]"],
];

const MAX_LENGTH = 400;

export function redactSensitive(value: string, maxLength = MAX_LENGTH): string {
  const redacted = REDACTIONS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value.replace(/\s+/g, " ").trim(),
  );
  return redacted.length > maxLength
    ? `${redacted.slice(0, maxLength - 1)}…`
    : redacted;
}

/**
 * Neutralizes Markdown and mention syntax coming from untrusted input before it
 * is echoed back, so the bot cannot be used to ping people or forge structure.
 */
export function escapeForComment(value: string): string {
  return redactSensitive(value)
    .replace(/[<>]/g, "")
    .replace(/([@#])/g, "$1​")
    .replace(/([`*_[\]()])/g, "\\$1");
}
