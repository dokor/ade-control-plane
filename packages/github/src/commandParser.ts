import type { ParsedGithubCommand } from "./domain.js";
import { GithubRejection } from "./errors.js";

export const COMMAND_MENTION = "@ade";

/** Lines scanned per comment; a wall of text cannot turn into a scan cost. */
const MAX_SCANNED_LINES = 200;
const MAX_LINE_LENGTH = 512;

const MENTION_LINE = /^@ade[ \t]+(.*)$/i;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const MINIMUM_PRIORITY = 0;
export const MAXIMUM_PRIORITY = 100;

/**
 * Parses the first `@ade` directive in a comment.
 *
 * The grammar is a closed vocabulary with strictly validated arguments: GitHub
 * text never becomes a shell string, a raw ADE command or a free-form payload.
 *
 * Returns `null` when the comment simply contains no directive, so ordinary
 * discussion stays silent instead of being answered by the bot.
 */
export function parseCommand(body: string): ParsedGithubCommand | null {
  for (const line of directiveLines(body)) {
    const match = MENTION_LINE.exec(line);
    if (!match) continue;

    const argv = tokenize(match[1] ?? "");
    if (argv.length === 0) continue;

    return toCommand(argv);
  }
  return null;
}

/**
 * Yields candidate lines, skipping fenced code blocks and quoted text.
 *
 * Quoting or pasting someone else's `@ade pause` must not re-trigger it, which
 * also removes the obvious replay vector through a quoted reply.
 */
function* directiveLines(body: string): Generator<string> {
  let fenced = false;

  for (const raw of body.split(/\r?\n/, MAX_SCANNED_LINES)) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || line.startsWith(">") || line.length > MAX_LINE_LENGTH) continue;
    // Strip surrounding Markdown emphasis so `**@ade pause**` still parses.
    yield line.replace(/^[*_`~]+/, "").replace(/[*_`~]+$/, "").trim();
  }
}

function tokenize(rest: string): readonly string[] {
  return rest
    .replace(/[`*_]/g, "")
    .split(/[ \t]+/)
    .filter((token) => token.length > 0);
}

function toCommand(argv: readonly string[]): ParsedGithubCommand {
  const verb = (argv[0] ?? "").toLowerCase();

  switch (verb) {
    case "status":
      return { type: "status" };
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    case "retry":
      return { type: "retry" };
    case "priority":
      return { type: "priority", priority: readPriority(argv[1]) };
    case "decide":
      return {
        type: "decide",
        decisionRef: readReference(argv[1], "decision reference"),
        option: readReference(argv[2], "decision option"),
      };
    default:
      throw new GithubRejection("UNKNOWN_COMMAND", "Command verb is not supported.");
  }
}

function readPriority(value: string | undefined): number {
  if (value === undefined || !/^\d{1,3}$/.test(value)) {
    throw new GithubRejection("INVALID_ARGUMENT", "Priority must be an integer.");
  }

  const priority = Number(value);
  if (priority < MINIMUM_PRIORITY || priority > MAXIMUM_PRIORITY) {
    throw new GithubRejection(
      "INVALID_ARGUMENT",
      `Priority must be between ${MINIMUM_PRIORITY} and ${MAXIMUM_PRIORITY}.`,
    );
  }
  return priority;
}

function readReference(value: string | undefined, label: string): string {
  if (value === undefined || !REFERENCE.test(value)) {
    throw new GithubRejection("INVALID_ARGUMENT", `A valid ${label} is required.`);
  }
  return value;
}
