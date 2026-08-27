import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeActor,
  authorizeInstallation,
  authorizeRepository,
  parseActorIdList,
} from "../src/authorization.js";

const policy = { allowedActorIds: ["11472726"] };
const human = { id: "11472726", login: "dokor", bot: false };
const stranger = { id: "999", login: "drive-by", bot: false };

test("maps a repository by numeric id only", () => {
  const projects = [{ projectId: "project-1", repositoryId: "1347812108" }];
  assert.equal(
    authorizeRepository({ id: "1347812108", owner: "dokor", name: "argos" }, projects)
      .projectId,
    "project-1",
  );
  // A payload naming the right owner/name but a different id is not enough.
  assert.throws(
    () => authorizeRepository({ id: "42", owner: "dokor", name: "argos" }, projects),
    /UNKNOWN_REPOSITORY/,
  );
});

test("refuses actors outside the allow-list", () => {
  assert.doesNotThrow(() => authorizeActor(human, { type: "status" }, policy));
  assert.throws(
    () => authorizeActor(stranger, { type: "status" }, policy),
    /UNAUTHORIZED_ACTOR/,
  );
});

test("never lets a bot drive the control plane", () => {
  assert.throws(
    () => authorizeActor({ ...human, bot: true }, { type: "status" }, policy),
    /UNAUTHORIZED_ACTOR/,
  );
});

test("applies a stricter policy to mutating commands", () => {
  const readOnlyForHuman = {
    allowedActorIds: ["11472726"],
    allowedMutatingActorIds: ["1"],
  };
  assert.doesNotThrow(() => authorizeActor(human, { type: "status" }, readOnlyForHuman));
  assert.throws(
    () => authorizeActor(human, { type: "pause" }, readOnlyForHuman),
    /UNAUTHORIZED_ACTOR/,
  );
});

test("restricts installations when the allow-list is configured", () => {
  assert.doesNotThrow(() => authorizeInstallation(null, policy));
  assert.doesNotThrow(() =>
    authorizeInstallation("555", { ...policy, allowedInstallationIds: ["555"] }),
  );
  assert.throws(
    () => authorizeInstallation("666", { ...policy, allowedInstallationIds: ["555"] }),
    /UNAUTHORIZED_ACTOR/,
  );
  assert.throws(
    () => authorizeInstallation(null, { ...policy, allowedInstallationIds: ["555"] }),
    /UNAUTHORIZED_ACTOR/,
  );
});

test("parses actor id configuration and drops non-numeric entries", () => {
  assert.deepEqual(parseActorIdList("1, 2 ,dokor,,3"), ["1", "2", "3"]);
  assert.deepEqual(parseActorIdList(undefined), []);
});
