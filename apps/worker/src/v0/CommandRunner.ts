import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type CommandOutputStream = "stdout" | "stderr";

export interface CommandOutput {
  stream: CommandOutputStream;
  message: string;
}

export interface CommandInput {
  executable: string;
  args: readonly string[];
  cwd: string;
  stdin?: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  onOutput?(output: CommandOutput): void | Promise<void>;
}

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(input: CommandInput): Promise<CommandResult>;
}

const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_OUTPUT_LINE_BYTES = 8 * 1024;
const MAX_PENDING_OUTPUT_LINES = 256;
const KILL_GRACE_MS = 5_000;

export class NodeCommandRunner implements CommandRunner {
  public async run(input: CommandInput): Promise<CommandResult> {
    if (input.signal?.aborted) throw abortError();

    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      env: input.env ?? process.env,
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let pendingOutput = Promise.resolve();
    let pendingOutputLines = 0;
    let droppedOutputLines = 0;
    const queueOutput = (output: CommandOutput): void => {
      if (!input.onOutput) return;
      if (pendingOutputLines >= MAX_PENDING_OUTPUT_LINES) {
        droppedOutputLines += 1;
        return;
      }
      pendingOutputLines += 1;
      pendingOutput = pendingOutput.then(async () => {
        try {
          await input.onOutput?.(output);
        } finally {
          pendingOutputLines -= 1;
        }
      });
    };
    const stdoutLines = new BoundedLineDecoder((message) => {
      stdout = appendBounded(stdout, message);
      queueOutput({ stream: "stdout", message });
    });
    const stderrLines = new BoundedLineDecoder((message) => {
      stderr = appendBounded(stderr, message);
      queueOutput({ stream: "stderr", message });
    });

    child.stdout.on("data", (chunk: Buffer) => stdoutLines.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrLines.write(chunk));

    const abort = (): void => terminate(child);
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.stdin !== undefined) child.stdin.end(input.stdin, "utf8");
    else child.stdin.end();

    try {
      const result = await new Promise<CommandResult>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => {
          stdoutLines.end();
          stderrLines.end();
          void pendingOutput.then(
            async () => {
              if (droppedOutputLines > 0) {
                await input.onOutput?.({
                  stream: "stderr",
                  message: `${droppedOutputLines} output lines omitted while log persistence was backlogged.`,
                });
              }
              resolve({ exitCode, signal, stdout, stderr });
            },
            reject,
          ).catch(reject);
        });
      });
      if (input.signal?.aborted) throw abortError();
      return result;
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  }
}

class BoundedLineDecoder {
  private buffered = Buffer.alloc(0);

  public constructor(private readonly emit: (line: string) => void) {}

  public write(chunk: Buffer): void {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    this.flush(false);
  }

  public end(): void {
    this.flush(true);
  }

  private flush(final: boolean): void {
    while (this.buffered.length > 0) {
      const newline = this.buffered.indexOf(0x0a);
      if (newline < 0 && !final && this.buffered.length <= MAX_OUTPUT_LINE_BYTES) return;
      const end = newline >= 0 ? newline : Math.min(this.buffered.length, MAX_OUTPUT_LINE_BYTES);
      const line = this.buffered.subarray(0, end).toString("utf8").replace(/\r$/u, "");
      this.buffered = this.buffered.subarray(newline >= 0 ? end + 1 : end);
      if (line) this.emit(line);
      if (newline < 0 && !final && this.buffered.length <= MAX_OUTPUT_LINE_BYTES) return;
    }
  }
}

function appendBounded(current: string, line: string): string {
  const next = current ? `${current}\n${line}` : line;
  const bytes = Buffer.from(next, "utf8");
  if (bytes.length <= MAX_CAPTURE_BYTES) return next;
  return bytes.subarray(bytes.length - MAX_CAPTURE_BYTES).toString("utf8").replace(/^\uFFFD/u, "");
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  sendSignal(child, "SIGTERM");
  const force = setTimeout(() => sendSignal(child, "SIGKILL"), KILL_GRACE_MS);
  force.unref();
}

function sendSignal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.killed) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function abortError(): Error {
  const error = new Error("Command was aborted.");
  error.name = "AbortError";
  return error;
}
