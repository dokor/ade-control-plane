import Link from "next/link";

import { ProjectOnboardingForm } from "../../../components/ProjectOnboardingForm.js";
import { Shell } from "../../../components/Shell.js";
import { requireAuthenticatedContext } from "../../../lib/auth.js";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const { session, config } = await requireAuthenticatedContext("/projects/new");
  return <Shell title="Add project" actorRef={session.actorRef} refreshIntervalMs={config.refreshIntervalMs}>
    <p className="muted"><Link href="/">← Overview</Link></p>
    <ProjectOnboardingForm />
  </Shell>;
}
