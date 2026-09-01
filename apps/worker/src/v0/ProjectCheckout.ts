import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { ProjectRecord } from "@ade-control-plane/database";

export interface V0ProjectCheckout {
  root: string;
  baseBranch: string;
}

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export class ProjectCheckoutError extends Error {
  public constructor(
    public readonly code: "CHECKOUT_NOT_FOUND" | "CHECKOUT_UNAVAILABLE" | "CHECKOUT_CONFIGURATION_INVALID",
    public readonly safeSummary: string,
  ) {
    super(safeSummary);
    this.name = "ProjectCheckoutError";
  }
}

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
    throw new ProjectCheckoutError("CHECKOUT_CONFIGURATION_INVALID", "The registered project checkout path is invalid.");
  }
  if (typeof baseBranch !== "string" || !GIT_REF.test(baseBranch)) {
    throw new ProjectCheckoutError("CHECKOUT_CONFIGURATION_INVALID", "The registered project base branch is invalid.");
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(projectRoot);
  } catch {
    throw new ProjectCheckoutError("CHECKOUT_UNAVAILABLE", "The worker checkout root is unavailable.");
  }
  let canonicalCheckout: string;
  try {
    canonicalCheckout = await realpath(resolve(canonicalRoot, checkout));
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") {
      throw new ProjectCheckoutError("CHECKOUT_NOT_FOUND", "The registered project checkout has not been provisioned yet.");
    }
    throw new ProjectCheckoutError("CHECKOUT_UNAVAILABLE", "The registered project checkout cannot be accessed by the worker.");
  }
  const contained = relative(canonicalRoot, canonicalCheckout);
  if (contained.startsWith("..") || isAbsolute(contained) || contained === "") {
    throw new ProjectCheckoutError("CHECKOUT_CONFIGURATION_INVALID", "The registered project checkout is outside the allow-listed root.");
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
