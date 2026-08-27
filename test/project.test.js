import test from "node:test";
import assert from "node:assert/strict";
import { inspectLock, readProject } from "../lib/project.js";
import { DEFAULT_POLICY } from "../lib/constants.js";
import { makeProject } from "./helpers.js";

test("resolves exact direct dependency versions from a v3 lockfile", async () => {
  const directory = await makeProject();
  const project = await readProject(directory);
  assert.deepEqual(project.direct, [{ name: "alpha", version: "1.2.3", dev: false }]);
});

test("lock inspection rejects unexpected install scripts and missing integrity", async () => {
  const directory = await makeProject({ alphaEntry: { hasInstallScript: true, integrity: undefined } });
  const project = await readProject(directory);
  const result = inspectLock(project.lock, structuredClone(DEFAULT_POLICY));
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0], /hasInstallScript/);
  assert.match(result.failures[1], /integrity/);
});

test("default lock allowlist permits fsevents install script", () => {
  const lock = {
    packages: {
      "": {},
      "node_modules/fsevents": {
        version: "2.3.3",
        resolved: "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
        integrity: `sha512-${Buffer.from("value").toString("base64")}`,
        hasInstallScript: true,
      },
    },
  };
  assert.deepEqual(inspectLock(lock, structuredClone(DEFAULT_POLICY)).failures, []);
});
