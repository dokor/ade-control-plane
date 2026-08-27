import {
  ActiveTaskConflictError,
  DatabaseRecordNotFoundError,
  type ControlPlanePersistence,
  type V0TaskLogStream,
  type V0TaskRecord,
} from "@ade-control-plane/database";

import { ControlError } from "./errors.js";
import { sanitizeText } from "./sanitize.js";

export interface CreateTaskInput {
  projectId: string;
  prompt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createTask(
  persistence: ControlPlanePersistence,
  input: CreateTaskInput,
  now = new Date().toISOString(),
): Promise<V0TaskRecord> {
  if (
    !UUID.test(input.projectId) ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    input.prompt.length > 20_000
  ) {
    throw new ControlError(
      "INVALID_COMMAND",
      "Project and prompt are required; prompt length is limited to 20000 characters.",
    );
  }
  const project = await persistence.projects.getById(input.projectId);
  if (!project) {
    throw new ControlError("NOT_FOUND", "The selected project is not registered.");
  }

  try {
    return await persistence.v0Tasks.create({
      projectId: input.projectId,
      prompt: input.prompt,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof ActiveTaskConflictError) {
      throw new ControlError("CONFLICT", "Another task is already pending or running.");
    }
    throw error;
  }
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
