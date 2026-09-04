import { AsyncLocalStorage } from "node:async_hooks";
import type { CommandInput, CommandResult, CommandRunner } from "./CommandRunner.js";

// A per-invocation scope lets nested ADE/provisioning commands retain evidence
// even when their caller replaces the original error with a safe domain error.
interface Context {
  stage: string;
  secrets: readonly string[];
  command?: string;
  result?: CommandResult;
  cause?: unknown;
  privateKeyStreams: Set<string>;
}
const context = new AsyncLocalStorage<Context>();

export function withExecutionDiagnostics<T>(secrets: readonly string[], run: () => Promise<T>): Promise<T> {
  return context.run({ stage: "Resolve registered project", secrets: secrets.flatMap((value) => [value, ...value.split(/\r?\n/u)]), privateKeyStreams: new Set() }, run);
}

export function executionStage(stage: string): void {
  const current = context.getStore();
  if (current) { current.stage = stage; delete current.command; delete current.result; delete current.cause; }
}

export function diagnosticCommands(commands: CommandRunner): CommandRunner {
  return { run: (input) => observeCommand(commands, input) };
}

export async function observeCommand(commands: CommandRunner, input: CommandInput): Promise<CommandResult> {
  const current = context.getStore();
  if (!current) return commands.run(input);
  // Never log arguments, stdin, cwd or environment. Only known operation words
  // identify the command; flags/values may contain credentials or prompt text.
  const operations = new Set(["clone", "remote", "get-url", "fetch", "switch", "status", "rev-parse", "ls-remote", "add", "commit", "push",
    "exec", "delivery", "plan", "config", "validate", "context", "generate", "pack", "setup", "check", "review", "--version"]);
  const args = [...input.args];
  while (args[0] === "-c" || args[0] === "-C") args.splice(0, 2);
  const words: string[] = [];
  for (const arg of args) { if (!operations.has(arg)) break; words.push(arg); if (words.length === 3) break; }
  current.command = `${input.executable.split(/[\\/]/u).pop()} ${words.join(" ")} [arguments omitted]`.trim();
  delete current.result; delete current.cause;
  try { const result = await commands.run(input); current.result = result; return result; }
  catch (error) { current.cause = error; throw error; }
}

export function recordAgentFailure(provider: string, result: CommandResult): void {
  const current = context.getStore();
  if (current) { current.command ??= `${provider} [arguments omitted]`; current.result = result; }
}

export function redactCommandOutput(stream: string, message: string): string {
  const streams = context.getStore()?.privateKeyStreams;
  const starts = /-----BEGIN [^-]*PRIVATE KEY-----/u.test(message);
  const ends = /-----END [^-]*PRIVATE KEY-----/u.test(message);
  if (starts || streams?.has(stream)) {
    if (ends) streams?.delete(stream); else streams?.add(stream);
    return "[redacted-key]";
  }
  return redactDiagnostic(message, 4000);
}

export function redactDiagnostic(value: string, maximumBytes = 1800): string {
  let safe = value;
  for (const secret of context.getStore()?.secrets ?? []) {
    if (secret.length >= 4) safe = safe.split(secret).join("[redacted]");
  }
  safe = safe
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu, "[redacted-key]")
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+|\bsk-[A-Za-z0-9_-]+/gu, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, "[redacted-token]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/giu, "[redacted-auth]")
    .replace(/\b[\w-]*(?:password|secret|token|authorization|api[_-]?key)[\w-]*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}]+)/giu, "[redacted-secret]")
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/gu, "[redacted-env]")
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s"']+/giu, "[redacted-url]")
    .replace(/(?:\/(?:home|root|run|etc|var|proc|Users)|[A-Za-z]:[\\/])[^\s"']*/gu, "[redacted-path]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "");
  return Buffer.from(safe).subarray(0, maximumBytes).toString("utf8").replace(/\uFFFD$/u, "");
}

export function failureDiagnostic(taskId: string, projectId: string, code: string, error: unknown) {
  const current = context.getStore();
  const cause = current?.cause ?? error;
  const internalCode = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string" ? cause.code : "";
  const diagnostic = {
    event: "task.execution.failed", taskId, projectId, code: redactDiagnostic(code, 100),
    stage: current?.stage ?? "Unknown stage", errorType: redactDiagnostic(error instanceof Error ? error.name : typeof error, 80),
    internalCode: redactDiagnostic(internalCode, 80),
    message: redactDiagnostic(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Non-Error thrown", 350),
    stack: redactDiagnostic(cause instanceof Error ? cause.stack ?? "" : "", 550),
    command: redactDiagnostic(current?.command ?? "No command was started", 160),
    exitCode: current?.result?.exitCode ?? null, signal: current?.result?.signal ?? null,
    stderr: redactDiagnostic(current?.result?.stderr ?? "", 900),
  };
  // JSON escaping can expand control characters; preserve a valid bounded event.
  while (Buffer.byteLength(JSON.stringify(diagnostic)) > 3500) {
    diagnostic.stderr = diagnostic.stderr.slice(0, Math.floor(diagnostic.stderr.length / 2));
    diagnostic.stack = diagnostic.stack.slice(0, Math.floor(diagnostic.stack.length / 2));
    diagnostic.message = diagnostic.message.slice(0, Math.floor(diagnostic.message.length / 2));
  }
  return diagnostic;
}
