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
  retries: 2,
};

test("user config accepts retries above the removed upstream cap", () => {
  const config = applyUserConfig(baseConfig, { retries: 5 });
  assert.equal(config.retries, 5);
});

test("user config still rejects invalid retries values", () => {
  assert.throws(
    () => applyUserConfig(baseConfig, { retries: -1 }),
    /retries must be a non-negative integer/,
  );
  assert.throws(
    () => applyUserConfig(baseConfig, { retries: 2.5 }),
    /retries must be a non-negative integer/,
  );
});

test("project config may only lower the trusted retries value", () => {
  const trusted = applyUserConfig(baseConfig, { retries: 10 });
  assert.equal(applyProjectConfig(trusted, { retries: 4 }).retries, 4);
  assert.throws(
    () => applyProjectConfig(trusted, { retries: 11 }),
    /project retries may only lower the trusted value/,
  );
});

test("extension options validate the retries bound at the boundary", () => {
  assert.throws(
    () =>
      createPiAutoReviewExtension({
        config: { ...baseConfig, retries: 1.5 },
      }),
    /retries must be a non-negative integer/,
  );
});
