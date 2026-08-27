import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { checkProject } from "../lib/check.js";
import { DEFAULT_POLICY } from "../lib/constants.js";
import { jsonResponse, makeProject, packageDocument, passingRun } from "./helpers.js";

test("check runs only safe npm commands in the required order and writes evidence", async () => {
  const directory = await makeProject();
  const reportPath = join(directory, "evidence", "report.json");
  const calls = [];
  const document = packageDocument();
  const gitHead = document.versions["1.2.3"].gitHead;
  const fetch = async (url) => {
    if (url.startsWith("https://registry.npmjs.org/alpha")) return jsonResponse(document);
    throw new Error(`unexpected URL ${url}`);
  };
  const report = await checkProject({ path: directory, report: reportPath, policy: structuredClone(DEFAULT_POLICY) }, {
    fetch,
    remoteRefs: async () => [{ sha: gitHead, ref: "refs/tags/v1.2.3" }],
    run: passingRun(calls),
    now: () => Date.parse("2025-01-01T00:00:00Z"),
  });
  assert.equal(report.status, "pass");
  assert.deepEqual(calls.map((call) => call.slice(0, 3)), [
    ["npm", "pack", "alpha@1.2.3"],
    ["npm", "ci", "--ignore-scripts"],
    ["npm", "audit", "signatures"],
    ["npm", "audit", "--omit=dev"],
  ]);
  const saved = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(saved.commands.length, 4);
  assert.equal(saved.status, "pass");
});

test("check records npm pack size violations without installing", async () => {
  const directory = await makeProject();
  const reportPath = join(directory, "report.json");
  const document = packageDocument();
  const gitHead = document.versions["1.2.3"].gitHead;
  const report = await checkProject({ path: directory, report: reportPath, policy: { ...structuredClone(DEFAULT_POLICY), maxTarballSizeBytes: 10 }, skipInstall: true }, {
    fetch: async (url) => {
      if (url.startsWith("https://registry.npmjs.org/alpha")) return jsonResponse(document);
      throw new Error(`unexpected URL ${url}`);
    },
    remoteRefs: async () => [{ sha: gitHead, ref: "refs/tags/v1.2.3" }],
    run: passingRun(),
    now: () => Date.parse("2025-01-01T00:00:00Z"),
  });
  assert.equal(report.status, "fail");
  assert.ok(report.failures.some((message) => message.includes("tarball size")));
  assert.equal(report.commands.length, 1);
});

test("check applies an archive override only to its reviewed package version", async () => {
  const directory = await makeProject();
  const document = packageDocument();
  const gitHead = document.versions["1.2.3"].gitHead;
  const policy = { ...structuredClone(DEFAULT_POLICY), maxTarballSizeBytes: 10 };
  policy.archiveSizeExceptions.alpha = {
    version: "1.2.3",
    maxTarballSizeBytes: 100,
    reason: "Reviewed archive is larger than the default project limit.",
    expiresAt: "2025-02-01T00:00:00Z",
  };
  const report = await checkProject({ path: directory, report: join(directory, "report.json"), policy, skipInstall: true }, {
    fetch: async () => jsonResponse(document),
    remoteRefs: async () => [{ sha: gitHead, ref: "refs/tags/v1.2.3" }],
    run: passingRun(),
    now: () => Date.parse("2025-01-01T00:00:00Z"),
  });
  assert.equal(report.status, "pass");
});

test("check parses full npm pack JSON while truncating report evidence", async () => {
  const directory = await makeProject();
  const reportPath = join(directory, "report.json");
  const document = packageDocument();
  const gitHead = document.versions["1.2.3"].gitHead;
  const packOutput = JSON.stringify([{
    size: 100,
    unpackedSize: 500,
    files: Array.from({ length: 2_000 }, (_, index) => ({ path: `dist/file-${index}.js`, size: 1 })),
  }]);
  assert.ok(packOutput.length > 20_000);

  const report = await checkProject({ path: directory, report: reportPath, policy: structuredClone(DEFAULT_POLICY), skipInstall: true }, {
    fetch: async (url) => {
      if (url.startsWith("https://registry.npmjs.org/alpha")) return jsonResponse(document);
      throw new Error(`unexpected URL ${url}`);
    },
    remoteRefs: async () => [{ sha: gitHead, ref: "refs/tags/v1.2.3" }],
    run: async (_command, _args, options) => {
      assert.equal(options.maxOutputBytes, 25_000_000);
      return { code: 0, stdout: packOutput, stderr: "", timedOut: false };
    },
    now: () => Date.parse("2025-01-01T00:00:00Z"),
  });

  assert.equal(report.status, "pass");
  assert.equal(report.packages[0].tarballSizeBytes, 100);
  assert.equal(report.commands[0].stdout.length, 20_000);
});
