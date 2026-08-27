import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { initPolicy } from "../lib/init.js";
import { jsonResponse, makeProject, packageDocument } from "./helpers.js";

test("init pins repository and maintainers from the exact locked version", async () => {
  const directory = await makeProject();
  const output = join(directory, "policy.json");
  const result = await initPolicy({ path: directory, output }, { fetch: async () => jsonResponse(packageDocument()) });
  assert.equal(result.policy.trustedRepositories.alpha, "https://github.com/example/alpha");
  assert.deepEqual(result.policy.trustedMaintainers.alpha, ["alice"]);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), result.policy);
});

test("init does not trust a package without a GitHub repository", async () => {
  const directory = await makeProject();
  const output = join(directory, "policy.json");
  const document = packageDocument({ version: { repository: "https://gitlab.com/example/alpha" } });
  const result = await initPolicy({ path: directory, output }, { fetch: async () => jsonResponse(document) });
  assert.equal(result.policy.trustedRepositories.alpha, undefined);
  assert.match(result.skipped[0], /not trusted/);
});
