import type { GithubClient } from "./client.js";
import type { GithubRepositoryRef, GithubSubjectRef } from "./domain.js";
import { escapeForComment, redactSensitive } from "./redact.js";

export type BotCommentPurpose = "status" | "waiting-human" | "failure";

/**
 * Hidden marker identifying a control-plane comment.
 *
 * It is written into the body and the comment ID is persisted, so the bot can
 * update its own comment and can never overwrite human-authored content.
 */
export function commentMarker(purpose: BotCommentPurpose, projectId: string): string {
  return `<!-- ade-control-plane:${purpose}:${projectId} -->`;
}

export function isControlPlaneComment(body: string, projectId: string): boolean {
  return (["status", "waiting-human", "failure"] as const).some((purpose) =>
    body.includes(commentMarker(purpose, projectId)),
  );
}

export interface StatusCommentInput {
  projectName: string;
  status: string;
  priority: number;
  waitingReason: string | null;
  currentWork: string | null;
  dashboardUrl: string;
  observedAt: string;
}

/**
 * Project-scoped status only. Global quota, runner and scheduler views stay in
 * the Dashboard, which is linked rather than mirrored here.
 */
export function renderStatusComment(
  projectId: string,
  input: StatusCommentInput,
): string {
  const lines = [
    commentMarker("status", projectId),
    `**${escapeForComment(input.projectName)}** — \`${escapeForComment(input.status)}\``,
    "",
    `- priority: ${Math.trunc(input.priority)}`,
    `- waiting: ${input.waitingReason ? escapeForComment(input.waitingReason) : "not waiting"}`,
    `- current work: ${input.currentWork ? escapeForComment(input.currentWork) : "none reported by ADE"}`,
    `- observed: ${escapeForComment(input.observedAt)}`,
    "",
    `Quota, runners and scheduling are in the [Dashboard](${input.dashboardUrl}).`,
  ];
  return lines.join("\n");
}

export interface AcknowledgementInput {
  command: string;
  outcome: "applied" | "refused";
  summary: string;
  dashboardUrl: string;
}

export function renderAcknowledgement(
  projectId: string,
  input: AcknowledgementInput,
): string {
  return [
    commentMarker("status", projectId),
    `\`${escapeForComment(input.command)}\` — **${input.outcome}**`,
    "",
    redactSensitive(input.summary),
    "",
    `[Open the Dashboard](${input.dashboardUrl})`,
  ].join("\n");
}

export interface DecisionRequestInput {
  projectName: string;
  decisionRef: string;
  prompt: string;
  options: readonly string[];
  dashboardUrl: string;
}

export function renderDecisionRequest(
  projectId: string,
  input: DecisionRequestInput,
): string {
  return [
    commentMarker("waiting-human", projectId),
    `**${escapeForComment(input.projectName)}** is waiting for a decision.`,
    "",
    escapeForComment(input.prompt),
    "",
    ...input.options.map((option) => `- \`@ade decide ${escapeForComment(input.decisionRef)} ${escapeForComment(option)}\``),
    "",
    `[Open the Dashboard](${input.dashboardUrl})`,
  ].join("\n");
}

export interface BotCommentStore {
  /** Comment ID previously written by the control plane, when one exists. */
  find(
    projectId: string,
    purpose: BotCommentPurpose,
    subject: GithubSubjectRef,
  ): Promise<string | null>;
  remember(
    projectId: string,
    purpose: BotCommentPurpose,
    subject: GithubSubjectRef,
    commentId: string,
  ): Promise<void>;
}

/**
 * Updates the existing control-plane comment for this interaction, or creates
 * one. Repeated state changes about the same subject therefore reuse a single
 * comment instead of appending an unbounded thread.
 */
export async function upsertBotComment(
  client: GithubClient,
  store: BotCommentStore,
  projectId: string,
  purpose: BotCommentPurpose,
  repository: GithubRepositoryRef,
  subject: GithubSubjectRef,
  body: string,
): Promise<{ commentId: string; updated: boolean }> {
  const existing = await store.find(projectId, purpose, subject);
  if (existing) {
    await client.updateComment(repository, existing, body);
    return { commentId: existing, updated: true };
  }

  const created = await client.createComment(repository, subject.number, body);
  await store.remember(projectId, purpose, subject, created.id);
  return { commentId: created.id, updated: false };
}
