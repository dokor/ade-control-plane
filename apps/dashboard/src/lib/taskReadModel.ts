import type {
  ControlPlanePersistence,
  ProjectRecord,
  V0TaskLogRecord,
  V0TaskRecord,
} from "@ade-control-plane/database";

import { sanitizeText } from "./sanitize.js";

type TaskPersistence = Pick<ControlPlanePersistence, "projects" | "v0Tasks">;

export interface TaskProjectOption {
  id: string;
  name: string;
  repository: string;
}

export interface TaskListItem extends V0TaskRecord {
  projectName: string;
  repository: string;
}

export interface TaskDashboardModel {
  projects: readonly TaskProjectOption[];
  activeTask: TaskListItem | null;
  tasks: readonly TaskListItem[];
}

export interface TaskDetailModel {
  task: V0TaskRecord;
  project: ProjectRecord;
  logs: readonly V0TaskLogRecord[];
}

export async function buildTaskDashboard(
  persistence: TaskPersistence,
): Promise<TaskDashboardModel> {
  const [projects, tasks] = await Promise.all([
    persistence.projects.list(),
    persistence.v0Tasks.list(30),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const items = tasks.map((task) => taskListItem(task, projectById.get(task.projectId)));
  return {
    projects: projects
      .filter(({ state }) => state === "enabled")
      .map((project) => ({
        id: project.id,
        name: project.name,
        repository: `${project.repositoryOwner}/${project.repositoryName}`,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    activeTask:
      items.find(({ status }) => status === "PENDING" || status === "RUNNING") ?? null,
    tasks: items,
  };
}

export async function buildTaskDetail(
  persistence: TaskPersistence,
  taskId: string,
): Promise<TaskDetailModel | null> {
  const task = await persistence.v0Tasks.getById(taskId);
  if (!task) return null;
  const [project, logs] = await Promise.all([
    persistence.projects.getById(task.projectId),
    persistence.v0Tasks.listLogs(task.id, 2_000),
  ]);
  return project
    ? {
        task: sanitizeTask(task),
        project,
        logs: logs.map((log) => ({
          ...log,
          message: sanitizeText(log.message, 4_096),
        })),
      }
    : null;
}

export function safePullRequestUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
  } catch {
    return null;
  }
}

function taskListItem(
  task: V0TaskRecord,
  project: ProjectRecord | undefined,
): TaskListItem {
  return {
    ...sanitizeTask(task),
    projectName: project?.name ?? "Unknown project",
    repository: project
      ? `${project.repositoryOwner}/${project.repositoryName}`
      : "repository unavailable",
  };
}

function sanitizeTask(task: V0TaskRecord): V0TaskRecord {
  return {
    ...task,
    prompt: sanitizeText(task.prompt, 20_000),
    errorSummary: task.errorSummary ? sanitizeText(task.errorSummary) : null,
  };
}
