import type {
  ControlPlanePersistence,
  ExecutionRecord,
  GithubWorkItemRecord,
  ProjectRecord,
  V0TaskLogRecord,
  V0TaskRecord,
} from "@ade-control-plane/database";
import type { GithubIssueReader } from "@ade-control-plane/github";

import { sanitizeText } from "./sanitize.js";

type TaskPersistence = Pick<ControlPlanePersistence, "projects" | "v0Tasks" | "githubWork" | "executions">;

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
  githubWork: readonly GithubWorkListItem[];
  activeGithubWork: GithubWorkListItem | null;
}

export interface GithubWorkListItem {
  id: string;
  projectId: string;
  projectName: string;
  repository: string;
  issueNumber: number;
  issueUrl: string;
  state: GithubWorkItemRecord["state"];
  stage: string;
  executionStatus: ExecutionRecord["status"] | null;
  executionId: string | null;
  cancelRequested: boolean;
  executionError: string | null;
  pullRequestNumber: number | null;
}

export interface TaskDetailModel {
  task: V0TaskRecord;
  project: ProjectRecord;
  logs: readonly V0TaskLogRecord[];
  timeline: readonly TaskTimelineEvent[];
  summary: TaskExecutionSummary;
  title: string;
}

export type TaskTimelineEventKind =
  | "task"
  | "setup"
  | "agent"
  | "command"
  | "test"
  | "git"
  | "github"
  | "error";

export type TaskTimelineEventStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "cancelled"
  | "info";

export interface TaskTimelineEvent {
  id: string;
  occurredAt: string;
  kind: TaskTimelineEventKind;
  status: TaskTimelineEventStatus;
  title: string;
  detail: string | null;
}

export interface TaskExecutionSummary {
  status: TaskTimelineEventStatus;
  title: string;
  detail: string;
  firstFailure: TaskTimelineEvent | null;
  completedEvents: number;
}

export async function buildTaskDashboard(
  persistence: TaskPersistence,
  issueReader?: Pick<GithubIssueReader, "getIssue">,
): Promise<TaskDashboardModel> {
  const [projects, tasks] = await Promise.all([
    persistence.projects.list(),
    persistence.v0Tasks.list(30),
  ]);
  const [workItems, executionGroups] = await Promise.all([
    persistence.githubWork.listForProjects(projects.map(({ id }) => id)),
    Promise.all(projects.map((project) => persistence.executions.listByProjectId(project.id, 30))),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const executions = executionGroups.flat();
  const items = await Promise.all(tasks.map((task) =>
    taskListItem(task, projectById.get(task.projectId), issueReader),
  ));
  const githubWork = workItems
    .filter(({ present }) => present)
    .map((work) => githubWorkListItem(work, projectById.get(work.projectId), executions))
    .sort((left, right) => githubWorkRank(left) - githubWorkRank(right) || right.issueNumber - left.issueNumber);
  const activeGithubWork = githubWork.find(({ executionStatus, state }) =>
    executionStatus === "queued" || executionStatus === "leased" || executionStatus === "dispatched" || executionStatus === "running" || state === "running",
  ) ?? null;
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
    githubWork,
    activeGithubWork,
  };
}

function githubWorkListItem(
  work: GithubWorkItemRecord,
  project: ProjectRecord | undefined,
  executions: readonly ExecutionRecord[],
): GithubWorkListItem {
  const execution = work.executionRef
    ? executions.find(({ id }) => id === work.executionRef)
    : executions.find(({ workRef }) => workRef === `github:issue:${work.issueNumber}` && workRef !== null);
  return {
    id: work.id,
    projectId: work.projectId,
    projectName: project?.name ?? "Unknown project",
    repository: project ? `${project.repositoryOwner}/${project.repositoryName}` : "repository unavailable",
    issueNumber: work.issueNumber,
    issueUrl: work.issueUrl,
    state: work.state,
    stage: githubWorkStage(work.state, execution?.status ?? null),
    executionStatus: execution?.status ?? null,
    executionId: execution?.id ?? null,
    cancelRequested: execution?.cancelRequested === true,
    executionError: execution?.errorSummary ? sanitizeText(execution.errorSummary) : null,
    pullRequestNumber: work.pullRequestNumber,
  };
}

function githubWorkRank(work: GithubWorkListItem): number {
  if (work.executionStatus === "running" || work.executionStatus === "dispatched" || work.executionStatus === "leased" || work.executionStatus === "queued") return 0;
  if (work.state === "running") return 1;
  if (work.state === "ready") return 2;
  if (work.state === "waiting-human") return 3;
  return 4;
}

export function githubWorkStage(
  state: GithubWorkItemRecord["state"],
  executionStatus: ExecutionRecord["status"] | null,
): string {
  if (executionStatus === "queued" || executionStatus === "leased" || executionStatus === "dispatched") return "Preparing issue";
  if (executionStatus === "running" || state === "running") return "Developing";
  if (state === "ready") return "Ready for development";
  if (state === "waiting-human") return "Waiting for human";
  if (state === "completed") return "Completed";
  if (state === "failed") return "Failed";
  return "Blocked";
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
  const sanitizedLogs = logs.map((log) => ({
    ...log,
    message: sanitizeText(log.message, 4_096),
  }));
  const timeline = buildTaskTimeline(sanitizedTask, sanitizedLogs);
  return {
    task: sanitizedTask,
    project,
    logs: sanitizedLogs,
    timeline,
    summary: summarizeTask(sanitizedTask, timeline),
    title: await taskTitle(sanitizedTask, project, issueReader),
  };
}

export function buildTaskTimeline(
  task: V0TaskRecord,
  logs: readonly V0TaskLogRecord[],
): readonly TaskTimelineEvent[] {
  const events: TaskTimelineEvent[] = [];

  if (task.status === "PENDING") {
    events.push({
      id: `task:${task.id}:pending`,
      occurredAt: task.createdAt,
      kind: "task",
      status: "pending",
      title: "Waiting for the worker",
      detail: "The task is queued until the single execution slot is available.",
    });
  } else if (task.startedAt) {
    events.push({
      id: `task:${task.id}:started`,
      occurredAt: task.startedAt,
      kind: "task",
      status: "running",
      title: "Execution started",
      detail: "The worker claimed the task and began the delivery flow.",
    });
  }

  logs.forEach((log, index) => {
    const event = taskLogToTimelineEvent(log, index);
    if (event) events.push(event);
  });

  const terminalEvent = terminalTaskEvent(task);
  if (terminalEvent && !events.some((event) => event.id === terminalEvent.id)) {
    events.push(terminalEvent);
  }

  return events
    .map((event, index) => ({ event, index, timestamp: Date.parse(event.occurredAt) }))
    .sort((left, right) => {
      if (Number.isNaN(left.timestamp) && Number.isNaN(right.timestamp)) return left.index - right.index;
      if (Number.isNaN(left.timestamp)) return 1;
      if (Number.isNaN(right.timestamp)) return -1;
      return left.timestamp - right.timestamp || left.index - right.index;
    })
    .map(({ event }) => event);
}

function summarizeTask(
  task: V0TaskRecord,
  timeline: readonly TaskTimelineEvent[],
): TaskExecutionSummary {
  const firstFailure = timeline.find((event) => event.status === "failed") ?? null;
  const completedEvents = timeline.filter((event) => event.status === "success").length;

  if (task.status === "SUCCESS") {
    return {
      status: "success",
      title: "Task completed successfully",
      detail: task.pullRequestNumber
        ? `Pull request #${task.pullRequestNumber} is ready for human review.`
        : "The task completed and its changes are ready to review.",
      firstFailure,
      completedEvents,
    };
  }
  if (task.status === "FAILED") {
    return {
      status: "failed",
      title: "Task failed",
      detail: task.errorSummary ?? firstFailure?.detail ?? "The worker could not complete the task.",
      firstFailure,
      completedEvents,
    };
  }
  if (task.status === "CANCELLED") {
    return {
      status: "cancelled",
      title: "Task cancelled",
      detail: "The execution was stopped before a successful delivery was recorded.",
      firstFailure,
      completedEvents,
    };
  }
  if (task.status === "RUNNING") {
    return {
      status: "running",
      title: "Task is running",
      detail: "The worker is progressing through the delivery flow.",
      firstFailure,
      completedEvents,
    };
  }
  return {
    status: "pending",
    title: "Task is queued",
    detail: "The worker will start it when the execution slot is available.",
    firstFailure,
    completedEvents,
  };
}

function terminalTaskEvent(task: V0TaskRecord): TaskTimelineEvent | null {
  if (!task.finishedAt) return null;
  if (task.status === "SUCCESS") {
    return {
      id: `task:${task.id}:success`,
      occurredAt: task.finishedAt,
      kind: "task",
      status: "success",
      title: "Task completed",
      detail: task.pullRequestNumber
        ? `Pull request #${task.pullRequestNumber} was recorded.`
        : "The worker recorded a successful completion.",
    };
  }
  if (task.status === "FAILED") {
    return {
      id: `task:${task.id}:failed`,
      occurredAt: task.finishedAt,
      kind: "error",
      status: "failed",
      title: "Task failed",
      detail: task.errorCode
        ? `${task.errorCode}: ${task.errorSummary ?? "No further error detail was recorded."}`
        : task.errorSummary ?? "The worker recorded a failed completion.",
    };
  }
  if (task.status === "CANCELLED") {
    return {
      id: `task:${task.id}:cancelled`,
      occurredAt: task.finishedAt,
      kind: "task",
      status: "cancelled",
      title: "Task cancelled",
      detail: "The worker recorded a cancelled completion.",
    };
  }
  return null;
}

function taskLogToTimelineEvent(
  log: V0TaskLogRecord,
  index: number,
): TaskTimelineEvent | null {
  if (log.stream !== "system") return null;
  const message = log.message.trim();
  const command = /^(git fetch|git branch preparation|git commit|git push) (started|passed|failed)\.?$/u.exec(message);
  if (command) {
    const commandName = command[1] ?? "command";
    const commandOutcome = command[2] ?? "started";
    const commandLabels: Readonly<Record<string, string>> = {
      "git fetch": "Fetch base branch",
      "git branch preparation": "Prepare task branch",
      "git commit": "Commit changes",
      "git push": "Push task branch",
    };
    const status = commandOutcome === "started" ? "running" : commandOutcome === "passed" ? "success" : "failed";
    return {
      id: `log:${log.id}:${index}`,
      occurredAt: log.occurredAt,
      kind: commandName === "git branch preparation" || commandName === "git commit" || commandName === "git push" ? "git" : "command",
      status,
      title: commandLabels[commandName] ?? commandName,
      detail: status === "failed" ? `${commandName} failed.` : status === "success" ? `${commandName} completed.` : "The command is running.",
    };
  }
  if (message === "Preparing allow-listed checkout.") {
    return event(log, index, "setup", "success", "Prepare allow-listed checkout", "The registered repository checkout is being prepared.");
  }
  if (message.startsWith("ADE runtime ")) {
    return event(log, index, "setup", "success", "ADE runtime ready", message);
  }
  if (message.startsWith("ADE is not configured yet;")) {
    return event(log, index, "setup", "warning", "ADE configuration required", message);
  }
  if (message.startsWith("GitHub issue #")) {
    return event(log, index, "task", "info", "Source issue loaded", message);
  }
  if (message.startsWith("Starting ") || message.startsWith("Delivery gate: ")) {
    return event(log, index, "agent", "running", "Codex execution started", message);
  }
  if (/ execution passed\.?$/u.test(message)) {
    return event(log, index, "agent", "success", "Codex execution completed", message);
  }
  if (/ execution failed\.?$/u.test(message)) {
    return event(log, index, "error", "failed", "Codex execution failed", message);
  }
  if (message.startsWith("ADE deterministic review and profiles passed:")) {
    return event(log, index, "test", "success", "Delivery checks passed", message);
  }
  if (message === "Creating GitHub pull request.") {
    return event(log, index, "github", "running", "Create pull request", "GitHub PR creation is in progress.");
  }
  if (/pull request (created|reconciled)/iu.test(message)) {
    return event(log, index, "github", "success", "Pull request ready", message);
  }
  if (message === "Task cancelled.") {
    return event(log, index, "task", "cancelled", "Task cancelled", "Cancellation was observed by the worker.");
  }
  if (message.startsWith("Task failed:") || message.startsWith("PR-only retry failed:") || message.startsWith("Worker restarted")) {
    return event(log, index, "error", "failed", "Execution stopped with an error", message);
  }
  if (message.startsWith("PR-only retry reconciled")) {
    return event(log, index, "github", "success", "Pull request reconciled", message);
  }
  return event(log, index, "task", "info", message.replace(/[.]$/u, ""), null);
}

function event(
  log: V0TaskLogRecord,
  index: number,
  kind: TaskTimelineEventKind,
  status: TaskTimelineEventStatus,
  title: string,
  detail: string | null,
): TaskTimelineEvent {
  return { id: `log:${log.id}:${index}`, occurredAt: log.occurredAt, kind, status, title, detail };
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
  if (task.source.type === "ade-initialize") return "Initialize ADE configuration";
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
