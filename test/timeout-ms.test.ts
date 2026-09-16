import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyProjectConfig,
  applyUserConfig,
  createPiAutoReviewExtension,
  loadConfig,
  type Config,
} from "../src/index.ts";

const baseConfig: Config = {
  ...loadConfig(),
  timeoutMs: 90_000,
};

test("user config accepts timeoutMs through Node's timer maximum", () => {
  const config = applyUserConfig(baseConfig, { timeoutMs: 2_147_483_647 });
  assert.equal(config.timeoutMs, 2_147_483_647);
});

test("user config rejects timeoutMs outside the timer range", () => {
  assert.throws(
    () => applyUserConfig(baseConfig, { timeoutMs: 500 }),
    /timeoutMs must be an integer 1000\.\.2147483647/,
  );
  assert.throws(
    () => applyUserConfig(baseConfig, { timeoutMs: 1.5 }),
    /timeoutMs must be an integer 1000\.\.2147483647/,
  );
  assert.throws(
    () => applyUserConfig(baseConfig, { timeoutMs: 2_147_483_648 }),
    /timeoutMs must be an integer 1000\.\.2147483647/,
  );
});

test("project config may only lower the trusted timeoutMs value", () => {
  const trusted = applyUserConfig(baseConfig, { timeoutMs: 2_147_483_647 });
  assert.equal(applyProjectConfig(trusted, { timeoutMs: 120_000 }).timeoutMs, 120_000);
  assert.throws(
    () => applyProjectConfig(trusted, { timeoutMs: 2_147_483_648 }),
    /project timeoutMs may only lower the trusted value/,
  );
});

test("extension options validate the timeoutMs bound at the boundary", () => {
  assert.throws(
    () =>
      createPiAutoReviewExtension({
        config: { ...baseConfig, timeoutMs: 250 },
      }),
    /timeoutMs must be an integer 1000\.\.2147483647/,
  );
});
