import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../../../ade.config.json", import.meta.url);
const profileName = /^[a-z][a-z0-9-]{0,63}$/u;
const ruleId = /^[a-z][a-z0-9._/-]{0,127}$/u;

interface RepositoryAdeConfig {
  tools?: string[];
  rules?: Array<{ id?: string }>;
  profiles?: Record<string, unknown>;
  issueLifecycle?: {
    enrichment?: { enabled?: boolean; profile?: string };
    deliveryPlan?: {
      implementationProfile?: string;
      reviewProfiles?: string[];
      validationRuleIds?: string[];
    };
  };
}

async function repositoryConfig(): Promise<RepositoryAdeConfig> {
  return JSON.parse(await readFile(configUrl, "utf8")) as RepositoryAdeConfig;
}

test("repository ADE policy selects distinct code-health reviews and deterministic validation", async () => {
  const config = await repositoryConfig();
  const delivery = config.issueLifecycle?.deliveryPlan;

  assert.deepEqual(delivery?.reviewProfiles, [
    "architecture-maintainability",
    "security",
    "performance-resource-lifecycle",
    "final-quality",
  ]);
  assert.deepEqual(delivery?.validationRuleIds, ["development/service-size"]);
  assert.deepEqual(config.tools, ["typecheck", "test"]);
});

test("missing or invalid ADE profile and rule references cannot silently fall back", async () => {
  const config = await repositoryConfig();
  const delivery = config.issueLifecycle?.deliveryPlan;
  const configuredProfiles = new Set(Object.keys(config.profiles ?? {}));
  const configuredRules = new Set((config.rules ?? []).flatMap((rule) => rule.id ? [rule.id] : []));
  const selectedProfiles = [
    delivery?.implementationProfile,
    ...(delivery?.reviewProfiles ?? []),
    config.issueLifecycle?.enrichment?.profile,
  ];

  assert.equal(config.issueLifecycle?.enrichment?.enabled, true);
  assert.ok(selectedProfiles.every((profile): profile is string => typeof profile === "string" && profileName.test(profile) && configuredProfiles.has(profile)),
    "Unknown profile references must fail repository validation instead of falling back to a generic workflow.");
  assert.ok((delivery?.validationRuleIds ?? []).every((rule) => ruleId.test(rule) && configuredRules.has(rule)),
    "Unknown deterministic rule references must fail repository validation.");
  assert.equal(new Set(delivery?.reviewProfiles).size, delivery?.reviewProfiles?.length,
    "Specialist review passes must not be duplicated.");
});
