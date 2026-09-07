import assert from "node:assert/strict";
import test from "node:test";

import { selectRecentProjects } from "../src/lib/projectNavigation.js";

function project(id: string, createdAt: string) {
  return { id, name: `Project ${id}`, createdAt };
}

test("selects the five most recently created projects in descending order", () => {
  const projects = [
    project("one", "2026-09-01T10:00:00.000Z"),
    project("six", "2026-09-06T10:00:00.000Z"),
    project("three", "2026-09-03T10:00:00.000Z"),
    project("five", "2026-09-05T10:00:00.000Z"),
    project("two", "2026-09-02T10:00:00.000Z"),
    project("four", "2026-09-04T10:00:00.000Z"),
  ];
  const originalOrder = projects.map((item) => item.id);

  const recent = selectRecentProjects(projects);

  assert.deepEqual(recent.map((item) => item.id), ["six", "five", "four", "three", "two"]);
  assert.deepEqual(projects.map((item) => item.id), originalOrder);
});

test("returns only the available projects when fewer than five exist", () => {
  const recent = selectRecentProjects([
    project("older", "2026-09-01T10:00:00.000Z"),
    project("newer", "2026-09-02T10:00:00.000Z"),
  ]);

  assert.deepEqual(recent.map((item) => item.id), ["newer", "older"]);
  assert.deepEqual(selectRecentProjects([]), []);
});
