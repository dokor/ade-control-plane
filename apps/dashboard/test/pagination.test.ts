import assert from "node:assert/strict";
import test from "node:test";

import { paginate, parsePageParam } from "../src/lib/pagination.js";

test("paginates task history with 10 items per page while preserving order", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);

  const first = paginate(items, 1, 10);
  assert.deepEqual(first.items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(first.page, 1);
  assert.equal(first.totalPages, 3);
  assert.equal(first.hasPreviousPage, false);
  assert.equal(first.hasNextPage, true);

  const second = paginate(items, 2, 10);
  assert.deepEqual(second.items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(second.hasPreviousPage, true);
  assert.equal(second.hasNextPage, true);
});

test("clamps an out-of-range page to the last available page", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);
  const page = paginate(items, 99, 10);

  assert.equal(page.page, 3);
  assert.deepEqual(page.items, [21, 22, 23, 24, 25]);
  assert.equal(page.hasNextPage, false);
});

test("normalizes invalid page parameters to page one", () => {
  assert.equal(parsePageParam(undefined), 1);
  assert.equal(parsePageParam("invalid"), 1);
  assert.equal(parsePageParam("0"), 1);
  assert.equal(parsePageParam("2"), 2);
});
