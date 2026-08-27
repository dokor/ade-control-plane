import {
  authorizeActor,
  authorizeInstallation,
  isGithubRejection,
  isMutating,
  normalizeEvent,
  renderAcknowledgement,
  renderStatusComment,
  upsertBotComment,
  verifyWebhook,
  type BotCommentStore,
  type GithubAuthorizationPolicy,
  type GithubClient,
  type NormalizedGithubEvent,
  type ParsedGithubCommand,
  parseCommand,
  type WebhookHeaders,
} from "@ade-control-plane/github";
import type { ControlPlanePersistence, ProjectRecord } from "@ade-control-plane/database";

import {
  appendSecurityAudit,
  submitControlCommand,
  type ControlCommandRequest,
} from "./commands.js";
import { buildProjectDetail } from "./readModel.js";
import { sanitizeText } from "./sanitize.js";

export interface GithubWebhookDependencies {
  persistence: ControlPlanePersistence;
  webhookSecret: string;
  policy: GithubAuthorizationPolicy;
  dashboardUrl: string;
  quotaProvider: string;
  quotaAccountRef: string;
  /** Absent when no GitHub App credential is configured; the bot stays silent. */
  client?: GithubClient | undefined;
  now?: string;
  correlationId: string;
}

export type GithubWebhookOutcome =
  | { status: "rejected"; code: string; httpStatus: number }
  | { status: "duplicate"; deliveryId: string }
  | { status: "ignored"; code: string }
  | { status: "processed"; commandId: string | null; summary: string };

/**
 * Handles one GitHub delivery, in the order required by
 * `docs/GITHUB_INTEGRATION.md`.
 *
 * Nothing in this path executes ADE, Codex, Git or a host shell: the most it
 * ever does is persist a typed `ControlCommand` that the worker picks up later.
 */
export async function handleGithubDelivery(
  dependencies: GithubWebhookDependencies,
  rawBody: Buffer,
  headers: WebhookHeaders,
): Promise<GithubWebhookOutcome> {
  const now = dependencies.now ?? new Date().toISOString();

  let event: NormalizedGithubEvent;
  try {
    const verified = verifyWebhook(rawBody, headers, dependencies.webhookSecret);
    // Signature is validated before parsing, so hostile JSON never reaches a
    // parser on an unauthenticated path — and nothing is persisted yet, so an
    // unsigned flood cannot grow any table.
    event = normalizeEvent(verified.deliveryId, verified.event, verified.payload);
  } catch (error) {
    return { status: "rejected", code: rejectionCode(error), httpStatus: 400 };
  }

  const receipt = await dependencies.persistence.githubDeliveries.recordReceipt({
    deliveryId: event.deliveryId,
    event: event.event,
    action: event.action,
    repositoryGithubId: event.repository.id,
    actorRef: actorRef(event),
    subjectType: event.subject?.type ?? null,
    subjectNumber: event.subject?.number ?? null,
    commentId: event.comment?.id ?? null,
    receivedAt: now,
  });

  if (receipt.duplicate) {
    // Transport-level replay protection: a redelivered ID has zero extra effect.
    return { status: "duplicate", deliveryId: event.deliveryId };
  }

  const deliveryId = receipt.record.id;

  try {
    const project = await resolveProject(dependencies, event);
    if (!project) {
      return await ignore(dependencies, deliveryId, "UNKNOWN_REPOSITORY");
    }

    const command = readCommand(event);
    if (command === null) {
      return await ignore(dependencies, deliveryId, "NO_COMMAND");
    }

    authorizeInstallation(event.installationId, dependencies.policy);
    authorizeActor(event.actor, command, dependencies.policy);

    return await dispatch(dependencies, deliveryId, event, project, command, now);
  } catch (error) {
    const code = rejectionCode(error);
    await appendSecurityAudit(
      dependencies.persistence,
      {
        occurredAt: now,
        actorType: "github-user",
        actorRef: actorRef(event),
        correlationId: dependencies.correlationId,
        commandType: `github:${event.event}`,
      },
      error,
    );
    await dependencies.persistence.githubDeliveries.updateOutcome(deliveryId, {
      status: "rejected",
      rejectionCode: code,
      processedAt: now,
    });
    // An unauthorized actor gets no bot reply: the control plane does not
    // confirm to a stranger that this repository is managed.
    return { status: "rejected", code, httpStatus: 202 };
  }
}

async function resolveProject(
  dependencies: GithubWebhookDependencies,
  event: NormalizedGithubEvent,
): Promise<ProjectRecord | null> {
  // Authorization follows the numeric repository ID only; `owner/name` in the
  // payload is display data and is never trusted for routing.
  return dependencies.persistence.projects.getByRepositoryId(event.repository.id);
}

/** Only comment creation carries commands; edits and other actions are ignored. */
function readCommand(event: NormalizedGithubEvent): ParsedGithubCommand | null {
  if (event.event !== "issue_comment" || event.action !== "created") return null;
  if (!event.comment || !event.subject) return null;
  return parseCommand(event.comment.body);
}

async function dispatch(
  dependencies: GithubWebhookDependencies,
  deliveryId: string,
  event: NormalizedGithubEvent,
  project: ProjectRecord,
  command: ParsedGithubCommand,
  now: string,
): Promise<GithubWebhookOutcome> {
  if (!isMutating(command.type)) {
    const summary = await replyWithStatus(dependencies, event, project, now);
    await dependencies.persistence.githubDeliveries.updateOutcome(deliveryId, {
      status: "processed",
      processedAt: now,
    });
    return { status: "processed", commandId: null, summary };
  }

  const request = await toControlCommandRequest(dependencies, event, project, command);

  try {
    const outcome = await submitControlCommand(
      {
        persistence: dependencies.persistence,
        submitter: {
          source: "github",
          actorType: "github-user",
          actorRef: actorRef(event),
        },
        now,
        correlationId: dependencies.correlationId,
      },
      request,
    );

    await dependencies.persistence.githubDeliveries.updateOutcome(deliveryId, {
      status: "processed",
      controlCommandId: outcome.commandId,
      processedAt: now,
    });
    await acknowledge(dependencies, event, project, command, "applied", outcome.summary, now);
    return { status: "processed", commandId: outcome.commandId, summary: outcome.summary };
  } catch (error) {
    // An authorized actor asked for something the control plane refuses, such as
    // retrying an ambiguous outcome. They get a plain explanation rather than
    // silence, and the refusal is already persisted as a rejected command.
    const code = rejectionCode(error);
    await dependencies.persistence.githubDeliveries.updateOutcome(deliveryId, {
      status: "rejected",
      rejectionCode: code,
      processedAt: now,
    });
    await acknowledge(
      dependencies,
      event,
      project,
      command,
      "refused",
      refusalSummary(code),
      now,
    );
    return { status: "rejected", code, httpStatus: 202 };
  }
}

/** Stable, non-leaking explanations for refusals an operator can act on. */
function refusalSummary(code: string): string {
  const summaries: Readonly<Record<string, string>> = {
    RETRY_NOT_SAFE:
      "Retry refused: the last outcome is ambiguous and must be reconciled first.",
    NOT_FOUND: "The referenced execution or decision is unknown to the control plane.",
    INVALID_COMMAND: "The command arguments were not accepted.",
  };
  return summaries[code] ?? "The control plane refused this command.";
}

async function toControlCommandRequest(
  dependencies: GithubWebhookDependencies,
  event: NormalizedGithubEvent,
  project: ProjectRecord,
  command: ParsedGithubCommand,
): Promise<ControlCommandRequest> {
  // Derived from comment identity plus command, so the same directive replayed
  // through a redelivery or an edit resolves to the same command row.
  const idempotencyKey = `github:comment:${event.comment?.id ?? event.deliveryId}:${command.type}`;

  switch (command.type) {
    case "pause":
      return { type: "project.pause", payload: { projectId: project.id }, idempotencyKey };
    case "resume":
      return { type: "project.resume", payload: { projectId: project.id }, idempotencyKey };
    case "priority":
      return {
        type: "project.reprioritize",
        payload: { projectId: project.id, priority: command.priority },
        idempotencyKey,
      };
    case "decide":
      return {
        type: "ade.decide",
        payload: {
          projectId: project.id,
          decisionRef: command.decisionRef,
          option: command.option,
        },
        idempotencyKey,
      };
    case "retry": {
      const [latest] = await dependencies.persistence.executions.listByProjectId(
        project.id,
        1,
      );
      return {
        type: "execution.safe-retry",
        // Retryability is recomputed from the persisted record downstream, so a
        // GitHub comment can never declare its own retry safe.
        payload: { executionId: latest?.id ?? "" },
        idempotencyKey,
      };
    }
    default:
      return { type: "unsupported", payload: {}, idempotencyKey };
  }
}

async function replyWithStatus(
  dependencies: GithubWebhookDependencies,
  event: NormalizedGithubEvent,
  project: ProjectRecord,
  now: string,
): Promise<string> {
  const detail = await buildProjectDetail({
    persistence: dependencies.persistence,
    quotaProvider: dependencies.quotaProvider,
    quotaAccountRef: dependencies.quotaAccountRef,
    projectId: project.id,
    now,
  });

  const body = renderStatusComment(project.id, {
    projectName: project.name,
    status: detail?.project.status ?? "unknown",
    priority: project.priority,
    waitingReason: detail?.project.waitingReason ?? null,
    currentWork: detail?.project.currentWorkSummary ?? null,
    // Global quota, runner and scheduler views deliberately stay in the
    // Dashboard; GitHub only ever carries project-scoped state.
    dashboardUrl: `${dependencies.dashboardUrl}/projects/${project.id}`,
    observedAt: detail?.project.snapshotObservedAt ?? now,
  });

  await comment(dependencies, event, project.id, "status", body, now);
  await dependencies.persistence.auditEvents.append({
    occurredAt: now,
    category: "control",
    severity: "info",
    actorType: "github-user",
    actorRef: actorRef(event),
    projectId: project.id,
    action: "github.status",
    result: "served",
    correlationId: dependencies.correlationId,
    metadata: { deliveryId: event.deliveryId },
  });
  return "Status reported on GitHub.";
}

async function acknowledge(
  dependencies: GithubWebhookDependencies,
  event: NormalizedGithubEvent,
  project: ProjectRecord,
  command: ParsedGithubCommand,
  outcome: "applied" | "refused",
  summary: string,
  now: string,
): Promise<void> {
  const body = renderAcknowledgement(project.id, {
    command: `@ade ${command.type}`,
    outcome,
    summary: sanitizeText(summary),
    dashboardUrl: `${dependencies.dashboardUrl}/projects/${project.id}`,
  });
  await comment(dependencies, event, project.id, "status", body, now);
}

/**
 * Writes through the bot-comment store, which updates the control plane's own
 * comment for this subject instead of appending a new one each time. Human
 * comments are never referenced and never rewritten.
 */
async function comment(
  dependencies: GithubWebhookDependencies,
  event: NormalizedGithubEvent,
  projectId: string,
  purpose: "status" | "waiting-human" | "failure",
  body: string,
  now: string,
): Promise<void> {
  const client = dependencies.client;
  const subject = event.subject;
  if (!client || !subject) return;

  const store: BotCommentStore = {
    async find(id, commentPurpose, ref) {
      const record = await dependencies.persistence.githubBotComments.find(
        id,
        commentPurpose,
        ref.type,
        ref.number,
      );
      return record?.commentId ?? null;
    },
    async remember(id, commentPurpose, ref, commentId) {
      await dependencies.persistence.githubBotComments.remember({
        projectId: id,
        purpose: commentPurpose,
        subjectType: ref.type,
        subjectNumber: ref.number,
        commentId,
        updatedAt: now,
      });
    },
  };

  await upsertBotComment(
    client,
    store,
    projectId,
    purpose,
    event.repository,
    subject,
    body,
  );
}

async function ignore(
  dependencies: GithubWebhookDependencies,
  deliveryId: string,
  code: string,
): Promise<GithubWebhookOutcome> {
  await dependencies.persistence.githubDeliveries.updateOutcome(deliveryId, {
    status: "ignored",
    rejectionCode: code,
    processedAt: dependencies.now ?? new Date().toISOString(),
  });
  return { status: "ignored", code };
}

function actorRef(event: NormalizedGithubEvent): string {
  // Login plus numeric ID: logins can be renamed, IDs cannot.
  return `${event.actor.login}#${event.actor.id}`;
}

function rejectionCode(error: unknown): string {
  if (isGithubRejection(error)) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "INTERNAL";
}
