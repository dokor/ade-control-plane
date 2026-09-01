import type {
  ControlPlanePersistence,
  ProjectRecord,
  V0TaskLogRecord,
  V0TaskRecord,
} from "@ade-control-plane/database";
import type { GithubIssueReader } from "@ade-control-plane/github";

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
  title: string;
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
  title: string;
}

export async function buildTaskDashboard(
  persistence: TaskPersistence,
  issueReader?: Pick<GithubIssueReader, "getIssue">,
): Promise<TaskDashboardModel> {
  const [projects, tasks] = await Promise.all([
    persistence.projects.list(),
    persistence.v0Tasks.list(30),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const items = await Promise.all(tasks.map((task) =>
    taskListItem(task, projectById.get(task.projectId), issueReader),
  ));
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
  issueReader?: Pick<GithubIssueReader, "getIssue">,
): Promise<TaskDetailModel | null> {
  const task = await persistence.v0Tasks.getById(taskId);
  if (!task) return null;
  const [project, logs] = await Promise.all([
    persistence.projects.getById(task.projectId),
    persistence.v0Tasks.listLogs(task.id, 2_000),
  ]);
  if (!project) return null;
  const sanitizedTask = sanitizeTask(task);
  return {
    task: sanitizedTask,
    project,
    logs: logs.map((log) => ({
      ...log,
      message: sanitizeText(log.message, 4_096),
    })),
    title: await taskTitle(sanitizedTask, project, issueReader),
  };
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

async function taskListItem(
  task: V0TaskRecord,
  project: ProjectRecord | undefined,
  issueReader?: Pick<GithubIssueReader, "getIssue">,
): Promise<TaskListItem> {
  const sanitizedTask = sanitizeTask(task);
  return {
    ...sanitizedTask,
    projectName: project?.name ?? "Unknown project",
    repository: project
      ? `${project.repositoryOwner}/${project.repositoryName}`
      : "repository unavailable",
    title: await taskTitle(sanitizedTask, project, issueReader),
  };
}

async function taskTitle(
  task: V0TaskRecord,
  project: ProjectRecord | undefined,
  issueReader?: Pick<GithubIssueReader, "getIssue">,
): Promise<string> {
  if (task.source.type === "prompt") return sanitizeText(task.prompt, 240);
  const fallback = `GitHub issue #${task.source.issueNumber}`;
  if (!project || !issueReader) return fallback;

  try {
    const issue = await issueReader.getIssue({
      id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`,
      owner: project.repositoryOwner,
      name: project.repositoryName,
    }, task.source.issueNumber);
    return issue ? sanitizeText(issue.title, 240) : fallback;
  } catch {
    return fallback;
  }
}

export function sanitizeTaskRecord(task: V0TaskRecord): V0TaskRecord {
  return {
    ...task,
    source: task.source.type === "prompt"
      ? { type: "prompt", prompt: sanitizeText(task.source.prompt, 20_000) }
      : task.source,
    prompt: sanitizeText(task.prompt, 20_000),
    errorSummary: task.errorSummary ? sanitizeText(task.errorSummary) : null,
  };
}

function sanitizeTask(task: V0TaskRecord): V0TaskRecord {
  return sanitizeTaskRecord(task);
}
