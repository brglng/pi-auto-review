import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyProjectConfig,
  applyUserConfig,
  assertTrustedInstallation,
  loadConfig,
  loadTrustedConfig,
  userConfigPath,
} from "../src/index.ts";
import { protectedWriteHardDeny } from "../src/review/guards.ts";
import { sessionConfig } from "../src/review/input.ts";
import type { BoundaryRequest } from "../src/broker/types.ts";

const TEST_TMP_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  ".tmp",
);

function makeTempDir(prefix: string): string {
  mkdirSync(TEST_TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEST_TMP_ROOT, prefix));
}

test("project config can only tighten trusted settings and is frozen", () => {
  const trusted = loadConfig();
  const effective = applyProjectConfig(trusted, {
    timeoutMs: 10_000,
    retries: 0,
    maxReviewerInputTokens: 4_096,
    breakGlassEnabled: false,
    failureMode: "deny",
    autoConfirmBoundedAllows: [],
  });
  assert.equal(effective.timeoutMs, 10_000);
  assert.equal(effective.retries, 0);
  assert.equal(effective.maxReviewerInputTokens, 4_096);
  assert.equal(effective.breakGlassEnabled, false);
  assert.deepEqual(effective.policyAudit, { enabled: true, retentionDays: 180 });
  assert.equal(effective.model, trusted.model);
  assert.deepEqual(effective.autoConfirmBoundedAllows, []);
  assert.equal(Object.isFrozen(effective), true);
  assert.equal(Object.isFrozen(effective.autoConfirmBoundedAllows), true);

  assert.throws(() =>
    applyProjectConfig(trusted, { model: "attacker/reviewer" }),
  );
  assert.deepEqual(applyProjectConfig(trusted, { policyAudit: { retentionDays: 30 } }).policyAudit, {
    enabled: true,
    retentionDays: 30,
  });
  assert.deepEqual(applyProjectConfig(trusted, { policyAudit: { enabled: false } }).policyAudit, {
    enabled: false,
    retentionDays: 180,
  });
  assert.throws(() => applyProjectConfig(trusted, { policyAudit: { retentionDays: 181 } }));
  assert.throws(() => applyProjectConfig({ ...trusted, policyAudit: { enabled: false, retentionDays: 180 } }, { policyAudit: { enabled: true } }));
  assert.throws(() =>
    applyProjectConfig(trusted, { grantTtlMs: trusted.grantTtlMs + 1 }),
  );
  assert.throws(() =>
    applyProjectConfig(trusted, {
      maxReviewerInputTokens: trusted.maxReviewerInputTokens + 1,
    }),
  );
  assert.throws(() =>
    applyProjectConfig(trusted, { failureMode: "defer" }),
  );
  assert.throws(() =>
    applyProjectConfig(
      { ...trusted, breakGlassEnabled: false },
      { breakGlassEnabled: true },
    ),
  );
  assert.throws(() =>
    applyProjectConfig(
      { ...trusted, autoConfirmBoundedAllows: [] },
      { autoConfirmBoundedAllows: ["external_directory"] },
    ),
  );
});

test("user config can fully overlay package trusted settings", () => {
  const packageConfig = loadConfig();
  assert.equal(packageConfig.model, "codex-auto-review");
  assert.equal(packageConfig.maxTokens, 256);
  assert.equal(packageConfig.maxReviewerInputTokens, 8_192);
  assert.equal(packageConfig.breakGlassEnabled, true);
  const effective = applyUserConfig(packageConfig, {
    model: "user-provider/other-reviewer",
    autoConfirmBoundedAllows: ["external_directory", "path"],
    timeoutMs: 12_000,
    failureMode: "defer",
    policyAudit: { retentionDays: 365 },
  });
  assert.equal(effective.model, "user-provider/other-reviewer");
  assert.deepEqual(effective.autoConfirmBoundedAllows, [
    "external_directory",
    "path",
  ]);
  assert.equal(effective.timeoutMs, 12_000);
  assert.equal(effective.failureMode, "defer");
  assert.deepEqual(effective.policyAudit, { enabled: true, retentionDays: 365 });
  assert.equal(effective.retries, packageConfig.retries);

  const bareModel = applyUserConfig(packageConfig, {
    model: "codex-auto-review",
  });
  assert.equal(bareModel.model, "codex-auto-review");

  assert.throws(() => applyUserConfig(packageConfig, { model: "" }));
  assert.throws(() => applyUserConfig(packageConfig, { policyAudit: null }));
  for (const surface of [
    "path_read",
    "path_write",
    "external_directory_read",
    "external_directory_write",
  ]) {
    assert.throws(() =>
      applyUserConfig(packageConfig, { autoConfirmBoundedAllows: [surface] }),
    );
  }
  assert.throws(() =>
    applyUserConfig(packageConfig, { maxReviewerInputTokens: 2_047 }),
  );
  assert.throws(() =>
    applyUserConfig(packageConfig, { maxReviewerInputTokens: 32_769 }),
  );
  // Multi-segment model ids (provider/group/model) are valid and resolve like
  // parseModelRef: first segment is the provider, the rest is the model id.
  const nestedModel = applyUserConfig(packageConfig, {
    model: "acme/exam-group/example-flash",
  });
  assert.equal(nestedModel.model, "acme/exam-group/example-flash");
  // Malformed ids with empty segments are rejected.
  assert.throws(() =>
    applyUserConfig(packageConfig, { model: "provider/" }),
  );
  assert.throws(() =>
    applyUserConfig(packageConfig, { model: "/provider/model" }),
  );
  assert.throws(() =>
    applyUserConfig(packageConfig, { model: "a//b" }),
  );
  assert.throws(() =>
    applyUserConfig(packageConfig, { model: "has space" }),
  );
});

test("loadTrustedConfig merges optional user file over package defaults", () => {
  const root = makeTempDir("pi-auto-review-user-config-");
  const userPath = join(root, "config.json");
  const packageConfig = loadConfig();
  try {
    assert.deepEqual(
      loadTrustedConfig({
        packageConfig,
        userConfigPath: join(root, "missing.json"),
      }),
      packageConfig,
    );

    for (const content of ["", " \n\t "]) {
      writeFileSync(userPath, content);
      assert.deepEqual(
        loadTrustedConfig({ packageConfig, userConfigPath: userPath }),
        packageConfig,
      );
    }

    writeFileSync(
      userPath,
      JSON.stringify({
        autoConfirmBoundedAllows: ["external_directory", "path"],
      }),
    );
    const trusted = loadTrustedConfig({
      packageConfig,
      userConfigPath: userPath,
    });
    assert.deepEqual(trusted.autoConfirmBoundedAllows, [
      "external_directory",
      "path",
    ]);
    assert.equal(trusted.model, packageConfig.model);

    const project = applyProjectConfig(trusted, {
      autoConfirmBoundedAllows: ["external_directory"],
    });
    assert.deepEqual(project.autoConfirmBoundedAllows, ["external_directory"]);
    assert.throws(() =>
      applyProjectConfig(
        { ...packageConfig, autoConfirmBoundedAllows: ["external_directory"] },
        {
          autoConfirmBoundedAllows: ["external_directory", "path"],
        },
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty project config falls back to trusted config", () => {
  const root = makeTempDir("pi-auto-review-project-config-");
  const projectConfigPath = join(root, ".pi", "pi-auto-review.json");
  const trusted = loadConfig();
  try {
    mkdirSync(dirname(projectConfigPath), { recursive: true });
    for (const content of ["", " \n\t "]) {
      writeFileSync(projectConfigPath, content);
      assert.deepEqual(sessionConfig(root, trusted, true), trusted);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary Pi settings are not protected-write hard-denies", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-auto-review-protected-policy-"));
  const globalAgentDirectory = join(homedir(), ".pi", "agent");
  const ordinarySettings = [
    join(root, ".pi", "settings.json"),
    join(root, ".pi", "sandbox.json"),
    join(globalAgentDirectory, "settings.json"),
    join(globalAgentDirectory, "permissions.json"),
    join(globalAgentDirectory, "sandbox.json"),
  ];
  const protectedSettings = [
    join(root, ".pi", "pi-auto-review.json"),
    userConfigPath(),
    join(process.cwd(), "src", "config.json"),
  ];
  const hardDeny = (cwd: string, path: string) => protectedWriteHardDeny({
    id: "protected-file-policy",
    source: "sandbox-runtime",
    surface: "filesystem-write",
    operation: "write",
    cwd,
    path,
  } satisfies BoundaryRequest);

  try {
    for (const path of ordinarySettings) {
      assert.equal(hardDeny(root, path), undefined, path);
    }
    for (const path of protectedSettings) {
      assert.equal(hardDeny(root, path)?.rule, "security-control-tampering", path);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("userConfigPath resolves under the agent extensions directory", () => {
  assert.equal(
    userConfigPath("/home/demo"),
    "/home/demo/.pi/agent/extensions/pi-auto-review/config.json",
  );
});

test("security package loaded from the workspace is rejected", () => {
  const root = makeTempDir("pi-auto-review-trust-");
  const packageRoot = join(root, "packages", "pi-auto-review");
  mkdirSync(packageRoot, { recursive: true });
  try {
    assert.throws(
      () => assertTrustedInstallation(root, packageRoot),
      /agent-writable workspace/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
