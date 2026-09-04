import { sanitizeText } from "./sanitize.js";

export interface ExecutionDiagnosticView {
  taskId: string;
  stage: string;
  code: string;
  errorType: string;
  internalCode: string;
  message: string;
  command: string;
  exitCode: number | null;
  signal: string;
  stderr: string;
  stack: string;
}

/** Allow-listed projection, never a raw rendering of audit metadata. */
export function readExecutionDiagnostic(value: unknown, taskId: string): ExecutionDiagnosticView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.event !== "task.execution.failed" || data.taskId !== taskId) return null;
  const field = (key: string, max = 1000) => typeof data[key] === "string" ? sanitizeText(data[key], max) : "";
  return { taskId, stage: field("stage", 160), code: field("code", 100), errorType: field("errorType", 100),
    internalCode: field("internalCode", 100), message: field("message"), command: field("command", 250),
    exitCode: typeof data.exitCode === "number" && Number.isInteger(data.exitCode) ? data.exitCode : null,
    signal: field("signal", 50), stderr: field("stderr", 1800), stack: field("stack", 1000) };
}

export function diagnosticFromLog(message: string, taskId: string): ExecutionDiagnosticView | null {
  if (message.length > 4096) return null;
  try { return readExecutionDiagnostic(JSON.parse(message), taskId); } catch { return null; }
}
