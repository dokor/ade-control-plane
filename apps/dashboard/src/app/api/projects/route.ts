import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { ControlError, httpStatusForCode } from "../../../lib/errors.js";
import { loadGithubRuntime } from "../../../lib/githubRuntime.js";
import { getPersistence } from "../../../lib/persistence.js";
import { buildProjectOnboardingPlan, type ProjectOnboardingInput } from "../../../lib/projectOnboarding.js";
import { sanitizeError } from "../../../lib/sanitize.js";
import { authorizeTaskRequest } from "../../../lib/taskRequest.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  try {
    const identity = await authorizeTaskRequest(request, true);
    const body = (await request.json().catch(() => ({}))) as ProjectOnboardingInput;
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
    return NextResponse.json({ project, plan, checkoutStatus: "queued", correlationId }, { status: 201 });
  } catch (error) {
    const safe = sanitizeError(error, correlationId);
    return NextResponse.json(safe, { status: httpStatusForCode(safe.code) });
  }
}
