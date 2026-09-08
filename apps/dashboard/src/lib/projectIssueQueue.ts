import type { ControlPlanePersistence, ProjectRecord } from "@ade-control-plane/database";

import type { GithubRuntime } from "./githubRuntime.js";
import { ControlError } from "./errors.js";
import { listProjectGithubIssueQueue, type ProjectGithubIssueQueueItem } from "./githubIssues.js";

export async function loadProjectIssueQueue(
  project: ProjectRecord,
  persistence: Pick<ControlPlanePersistence, "githubWork">,
  github: GithubRuntime | null,
): Promise<readonly ProjectGithubIssueQueueItem[]> {
  if (!github?.issueReader) throw new ControlError("UNAVAILABLE", "GitHub issue queue is not configured.");
  const [workItems, preferences] = await Promise.all([
    persistence.githubWork.listForProject(project.id),
    persistence.githubWork.listQueuePreferences(project.id),
  ]);
  return listProjectGithubIssueQueue(project, github, workItems, preferences);
}
