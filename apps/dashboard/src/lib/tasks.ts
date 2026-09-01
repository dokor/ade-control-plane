import {
  ActiveTaskConflictError,
  DatabaseRecordNotFoundError,
  type ControlPlanePersistence,
  type V0TaskLogStream,
  type V0TaskRecord,
  type V0TaskSource,
} from "@ade-control-plane/database";

import { ControlError } from "./errors.js";
import { sanitizeText } from "./sanitize.js";

export interface CreateTaskInput {
  projectId: string;
  source?: V0TaskSource;
  prompt?: string;
}

export const ADE_INITIALIZATION_PROMPT =
  "Initialize ADE for this repository. Inspect the project, generate only the required ADE configuration files, validate them, and leave the changes ready for the worker to publish as a human-reviewed PR.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createTask(
  persistence: ControlPlanePersistence,
  input: CreateTaskInput,
  now = new Date().toISOString(),
): Promise<V0TaskRecord> {
  const source = normalizeTaskSource(input.source, input.prompt);
  if (
    !UUID.test(input.projectId) ||
    !source ||
    (source.type === "prompt" &&
      (!source.prompt.trim() || source.prompt.length > 20_000)) ||
    (source.type === "github-issue" &&
      (!Number.isInteger(source.issueNumber) || source.issueNumber < 1))
  ) {
    throw new ControlError(
      "INVALID_COMMAND",
      "Project and a valid prompt or GitHub issue are required.",
    );
  }
  const project = await persistence.projects.getById(input.projectId);
  if (!project) {
    throw new ControlError("NOT_FOUND", "The selected project is not registered.");
  }

  try {
    return await persistence.v0Tasks.create({
      projectId: input.projectId,
      prompt: source.type === "prompt"
        ? source.prompt
        : source.type === "ade-initialize"
          ? ADE_INITIALIZATION_PROMPT
          : `Implement GitHub issue #${source.issueNumber}`,
      source,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof ActiveTaskConflictError) {
      throw new ControlError("CONFLICT", "Another task is already pending or running.");
    }
    throw error;
  }
}

function normalizeTaskSource(
  value: V0TaskSource | undefined,
  legacyPrompt: string | undefined,
): V0TaskSource | null {
  const candidate: unknown = value ?? (
    typeof legacyPrompt === "string"
      ? { type: "prompt", prompt: legacyPrompt }
      : null
  );
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  if (
    "type" in candidate &&
    candidate.type === "prompt" &&
    "prompt" in candidate &&
    typeof candidate.prompt === "string"
  ) {
    return { type: "prompt", prompt: candidate.prompt };
  }
  if (
    "type" in candidate &&
    candidate.type === "github-issue" &&
    "issueNumber" in candidate &&
    typeof candidate.issueNumber === "number" &&
    Number.isInteger(candidate.issueNumber) &&
    candidate.issueNumber > 0
  ) {
    return { type: "github-issue", issueNumber: candidate.issueNumber };
  }
  if ("type" in candidate && candidate.type === "ade-initialize") {
    return { type: "ade-initialize" };
  }
  return null;
}

export async function taskDetail(persistence: ControlPlanePersistence, taskId: string) {
  if (!UUID.test(taskId)) {
    throw new ControlError("NOT_FOUND", "Task was not found.");
  }
  const task = await persistence.v0Tasks.getById(taskId);
  if (!task) {
    throw new ControlError("NOT_FOUND", "Task was not found.");
  }
  return { task, logs: await persistence.v0Tasks.listLogs(taskId, 2000) };
}

export async function cancelTask(
  persistence: ControlPlanePersistence,
  taskId: string,
  now = new Date().toISOString(),
) {
  try {
    return await persistence.v0Tasks.requestCancel(taskId, now);
  } catch (error) {
    if (error instanceof DatabaseRecordNotFoundError) {
      throw new ControlError("NOT_FOUND", "Task was not found.");
    }
    throw error;
  }
}

export async function appendSanitizedTaskLog(
  persistence: ControlPlanePersistence,
  taskId: string,
  stream: V0TaskLogStream,
  message: string,
  now = new Date().toISOString(),
) {
  return persistence.v0Tasks.appendLog({
    taskId,
    stream,
    occurredAt: now,
    message: sanitizeText(message, 4096),
  });
}
