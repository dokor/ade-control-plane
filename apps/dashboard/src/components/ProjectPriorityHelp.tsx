import type { ReactNode } from "react";

export const PROJECT_PRIORITY_EXPLANATION =
  "Higher values give eligible projects precedence when the scheduler chooses what to run. Priority never bypasses project state, ADE readiness, quota, runner compatibility, or safety gates.";

export function ProjectPriorityHelp({ id }: { id?: string }): ReactNode {
  return <p id={id} className="detail priority-help">{PROJECT_PRIORITY_EXPLANATION}</p>;
}
