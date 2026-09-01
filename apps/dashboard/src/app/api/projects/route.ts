import { NextResponse } from "next/server";

import { ControlError } from "../../../lib/errors.js";
import { handleDashboardApi, readJsonObject } from "../../../lib/dashboardApi.js";
import { loadGithubRuntime } from "../../../lib/githubRuntime.js";
import { getPersistence } from "../../../lib/persistence.js";
import { buildProjectOnboardingPlan, type ProjectOnboardingInput } from "../../../lib/projectOnboarding.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  return handleDashboardApi(request, "mutation", async ({ correlationId, identity }) => {
    if (!identity) throw new ControlError("UNAUTHENTICATED", "Authentication is required.");
    const body = await readJsonObject(request) as unknown as ProjectOnboardingInput;
    const persistence = await getPersistence();
    const plan = await buildProjectOnboardingPlan(body, await loadGithubRuntime(), await persistence.projects.list());
    const project = await persistence.projects.register({
      slug: plan.checkout,
      name: body.name?.trim() || plan.repository.name,
      repositoryOwner: plan.repository.owner,
      repositoryName: plan.repository.name,
      repositoryId: plan.repositoryId,
      state: "disabled",
      priority: 50,
      adeAdapter: "github-work",
      configuration: { v0: { checkout: plan.checkout, baseBranch: plan.defaultBranch } },
    });
    await persistence.auditEvents.append({
      occurredAt: new Date().toISOString(),
      category: "project-onboarding",
      severity: "info",
      actorType: "dashboard",
      actorRef: identity.actorRef,
      projectId: project.id,
      action: "project.onboarding.registered",
      result: "applied",
      correlationId,
      metadata: { repositoryId: plan.repositoryId, repository: `${plan.repository.owner}/${plan.repository.name}`, defaultBranch: plan.defaultBranch, checkout: plan.checkout, initialState: "disabled" },
    });
    return { body: { project, plan, checkoutStatus: "queued" }, status: 201 };
  });
}
