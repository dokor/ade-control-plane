import type {
  AuditEventRepository,
  GithubBotCommentRepository,
  GithubWorkItemRecord,
  ProjectRecord,
} from "@ade-control-plane/database";
import {
  renderFailureNotification,
  renderWaitingHumanNotification,
  upsertBotComment,
  type GithubClient,
} from "@ade-control-plane/github";

export interface GithubWorkNotifierOptions {
  persistence: {
    githubBotComments: Pick<GithubBotCommentRepository, "find" | "remember">;
    auditEvents: Pick<AuditEventRepository, "append">;
  };
  client: GithubClient;
  dashboardUrl: string;
  now?(): Date;
}

/** Posts only project-scoped human attention, with one durable bot comment per issue/purpose. */
export class GithubWorkNotifier {
  private readonly now: () => Date;

  public constructor(private readonly options: GithubWorkNotifierOptions) {
    this.now = options.now ?? (() => new Date());
  }

  public async waitingHuman(project: ProjectRecord, work: GithubWorkItemRecord): Promise<void> {
    if (!work.humanDecisionRef) return;
    await this.post(project, work, "waiting-human", renderWaitingHumanNotification(project.id, {
      projectName: project.name,
      issueNumber: work.issueNumber,
      dashboardUrl: this.projectUrl(project.id),
    }));
  }

  public async failure(project: ProjectRecord, work: GithubWorkItemRecord, errorCode: string): Promise<void> {
    await this.post(project, work, "failure", renderFailureNotification(project.id, {
      projectName: project.name,
      issueNumber: work.issueNumber,
      errorCode,
      dashboardUrl: this.projectUrl(project.id),
    }));
  }

  private async post(
    project: ProjectRecord,
    work: GithubWorkItemRecord,
    purpose: "waiting-human" | "failure",
    body: string,
  ): Promise<void> {
    const subject = { type: "issue" as const, number: work.issueNumber };
    try {
      const outcome = await upsertBotComment(
        this.options.client,
        {
          find: async (projectId, commentPurpose, ref) => {
            const comment = await this.options.persistence.githubBotComments.find(
              projectId, commentPurpose, ref.type, ref.number,
            );
            return comment?.commentId ?? null;
          },
          remember: async (projectId, commentPurpose, ref, commentId) => {
            await this.options.persistence.githubBotComments.remember({
              projectId, purpose: commentPurpose, subjectType: ref.type,
              subjectNumber: ref.number, commentId, updatedAt: this.now().toISOString(),
            });
          },
        },
        project.id,
        purpose,
        { id: work.repositoryGithubId, owner: project.repositoryOwner, name: project.repositoryName },
        subject,
        body,
      );
      await this.options.persistence.auditEvents.append({
        occurredAt: this.now().toISOString(), category: "github-notification", severity: "info",
        actorType: "system", projectId: project.id, action: `github.notification.${purpose}`,
        result: outcome.updated ? "updated" : "created", metadata: { issueNumber: work.issueNumber },
      });
    } catch {
      await this.options.persistence.auditEvents.append({
        occurredAt: this.now().toISOString(), category: "github-notification", severity: "warning",
        actorType: "system", projectId: project.id, action: `github.notification.${purpose}`,
        result: "deferred", metadata: { issueNumber: work.issueNumber },
      });
    }
  }

  private projectUrl(projectId: string): string {
    return `${this.options.dashboardUrl.replace(/\/$/u, "")}/projects/${projectId}`;
  }
}
