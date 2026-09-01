import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_PRIORITY_EXPLANATION } from "../src/components/ProjectPriorityHelp.js";

test("priority help explains precedence and scheduler gates", () => {
  assert.match(PROJECT_PRIORITY_EXPLANATION, /eligible projects.*precedence/i);
  assert.match(PROJECT_PRIORITY_EXPLANATION, /project state/i);
  assert.match(PROJECT_PRIORITY_EXPLANATION, /quota/i);
  assert.match(PROJECT_PRIORITY_EXPLANATION, /safety gates/i);
});
