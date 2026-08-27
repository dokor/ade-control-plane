import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { ProjectRecord } from "@ade-control-plane/database";

export interface V0ProjectCheckout {
  root: string;
  baseBranch: string;
}

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export async function resolveProjectCheckout(
  projectRoot: string,
  project: ProjectRecord,
): Promise<V0ProjectCheckout> {
  const config = asRecord(project.configuration.v0);
  const checkout = config.checkout;
  const baseBranch = config.baseBranch ?? "main";
  if (
    typeof checkout !== "string" ||
    !checkout ||
    isAbsolute(checkout) ||
    checkout.split(/[\\/]/u).some((part) => part === "..")
  ) {
    throw new Error("Project V0 checkout must be a relative allow-listed path.");
  }
  if (typeof baseBranch !== "string" || !GIT_REF.test(baseBranch)) {
    throw new Error("Project V0 base branch is invalid.");
  }

  const canonicalRoot = await realpath(projectRoot);
  const canonicalCheckout = await realpath(resolve(canonicalRoot, checkout));
  const contained = relative(canonicalRoot, canonicalCheckout);
  if (contained.startsWith("..") || isAbsolute(contained) || contained === "") {
    throw new Error("Project V0 checkout escapes or equals the allow-listed root.");
  }
  return { root: canonicalCheckout, baseBranch };
}

export function matchesGithubRemote(
  remote: string,
  owner: string,
  repository: string,
): boolean {
  const expected = `${owner}/${repository}`.toLowerCase();
  const trimmed = remote.trim().replace(/\.git$/iu, "");
  const scp = trimmed.match(/^git@github\.com:([^\s]+)$/iu);
  if (scp) return scp[1]?.toLowerCase() === expected;

  try {
    const url = new URL(trimmed);
    return (
      url.hostname.toLowerCase() === "github.com" &&
      !url.username &&
      !url.password &&
      url.pathname.replace(/^\//u, "").toLowerCase() === expected
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
