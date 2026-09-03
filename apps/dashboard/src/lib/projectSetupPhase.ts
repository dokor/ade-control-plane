export type ProjectSetupPhase = "repository" | "initialization" | "ready";

type SetupPhaseRequirement = {
  key: string;
  state: "ready" | "missing" | "invalid" | "optional";
};

/** Describes the next user-visible onboarding action, not just raw check state. */
export function projectSetupPhase(readiness: {
  ready: boolean;
  requirements: readonly SetupPhaseRequirement[];
}): ProjectSetupPhase {
  const repositoryReady = readiness.requirements
    .filter(({ key }) => key !== "runner-capability-check")
    .every(({ state }) => state === "ready" || state === "optional");
  if (!repositoryReady) return "repository";
  return readiness.ready ? "ready" : "initialization";
}
