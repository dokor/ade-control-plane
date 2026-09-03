"use client";

import { useEffect, useId, useState } from "react";

import type { ProjectSetupRequirement } from "../lib/projectSetup.js";
import { StatusBadge } from "./StatusBadge.js";

interface SetupHelpContent {
  title: string;
  explanation: string;
  steps: readonly string[];
  readyWhen: string;
}

const HELP_BY_KEY: Readonly<Record<string, SetupHelpContent>> = {
  "repository-access": {
    title: "Repository accessible",
    explanation: "Control Plane must be able to read the repository before it can inspect or prepare ADE setup.",
    steps: ["Confirm that the repository URL points to an existing GitHub repository.", "If it is private, make sure the ADE GitHub App is installed on this repository.", "Check that the App can read repository contents and labels."],
    readyWhen: "The Dashboard can read the repository profile, files and labels.",
  },
  "github-app": {
    title: "GitHub App access",
    explanation: "The GitHub App is the server-side identity used by the Dashboard to inspect and prepare this project.",
    steps: ["Install the ADE GitHub App on the organization or repository.", "Grant Metadata read access and Contents read/write access when setup changes must be prepared.", "Grant Issues and Pull requests access if GitHub issue selection and setup PRs are enabled."],
    readyWhen: "A repository-scoped App client can read the setup files and labels.",
  },
  "ade-config": {
    title: "ADE configuration",
    explanation: "This file declares the ADE contract and capabilities that the repository supports.",
    steps: ["The expected file is `.ade/control-plane.json`.", "For a new project, use “Create setup PR” to have Control Plane propose the file in a PR.", "If the file is invalid, correct it manually; existing invalid files are deliberately never overwritten."],
    readyWhen: "The file contains the supported `ade.github-work-profile/v1` version and valid capability and skill path arrays.",
  },
  runtime: {
    title: "ADE runtime compatible",
    explanation: "This check confirms that the Control Plane runtime understands the shared ADE contract used by the repository.",
    steps: ["No repository file needs to be changed for this item.", "If it is not ready, check the deployed ADE/Control Plane version and its runtime configuration."],
    readyWhen: "The deployed runtime supports the contract version displayed in the check.",
  },
  profiles: {
    title: "Profiles and rules available",
    explanation: "The ADE profile must advertise the GitHub work capability so issues can be interpreted as executable work.",
    steps: ["Open `.ade/control-plane.json` in the repository.", "Check that the profile is valid and includes the `github-work-items` capability.", "Ensure the declared skill paths exist or are intentionally managed by the project."],
    readyWhen: "Control Plane can resolve a valid profile with the GitHub work capability.",
  },
  instructions: {
    title: "Project instructions",
    explanation: "Agent instructions give Codex or another provider the project-specific rules it must follow.",
    steps: ["Add `AGENTS.md` or `CLAUDE.md` at the repository root.", "Describe conventions, useful commands, validation steps and constraints that are not obvious from the code.", "Use “Create setup PR” to let Control Plane propose a safe starter file when none exists."],
    readyWhen: "At least one supported instruction file is present in the default branch.",
  },
  context: {
    title: "Project context",
    explanation: "This optional note gives ADE additional project context, such as architecture, deployment or product constraints.",
    steps: ["Add `.ade/context.md` if the repository needs context beyond its normal documentation.", "Keep it concise and maintain it alongside the project.", "This item is optional and does not block readiness."],
    readyWhen: "The file exists; the project can also be ready without it.",
  },
  "issue-template": {
    title: "ADE issue template",
    explanation: "The template helps people create issues with the metadata expected by the ADE workflow.",
    steps: ["Add `.github/ISSUE_TEMPLATE/ade-work.yml` to the default branch.", "Use “Create setup PR” to let Control Plane propose a starter template in a PR.", "Review the generated template and adapt it to your team’s issue-writing habits."],
    readyWhen: "The template exists; this item is optional and does not block readiness.",
  },
  "github-labels": {
    title: "GitHub workflow labels",
    explanation: "ADE uses standard labels to express issue workflow states consistently across projects.",
    steps: ["The expected labels are `ready-for-dev`, `waiting-human` and `blocked`.", "Use “Create setup PR” to create missing labels directly through the GitHub App.", "If labels are managed centrally, create them yourself with the expected names and refresh the checks."],
    readyWhen: "All three standard labels exist in the repository.",
  },
};

const FALLBACK_HELP: SetupHelpContent = {
  title: "This setup check",
  explanation: "This item is part of the repository readiness contract used by ADE.",
  steps: ["Review the status detail shown next to the item.", "Correct the repository or GitHub configuration it describes.", "Refresh the checks after the change is available on the default branch."],
  readyWhen: "The server-side check can verify the expected configuration.",
};

export function ProjectSetupRequirementHelp({ requirement }: { requirement: ProjectSetupRequirement }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const content = HELP_BY_KEY[requirement.key] ?? FALLBACK_HELP;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" className="setup-help-button" title="How to fix this check" aria-label={`How to fix ${requirement.label}`} aria-expanded={open} onClick={() => setOpen(true)}>?</button>
      {open ? (
        <div className="setup-help-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="setup-help-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
            <div className="setup-help-heading">
              <div><p className="task-kicker">Setup guide</p><h3 id={titleId}>{content.title}</h3></div>
              <StatusBadge status={requirement.state} />
            </div>
            <p>{content.explanation}</p>
            <ol>{content.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <p><strong>Ready when:</strong> {content.readyWhen}</p>
            <button type="button" className="button primary" onClick={() => setOpen(false)} autoFocus>Close</button>
          </section>
        </div>
      ) : null}
    </>
  );
}
