import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY } from "../lib/constants.js";
import { verifyDirectPackage } from "../lib/verify.js";
import { jsonResponse, packageDocument } from "./helpers.js";

const item = { name: "alpha", version: "1.2.3", dev: false };
const now = () => Date.parse("2025-01-01T00:00:00Z");

test("verifies SLSA source repository, tag ref, and existing commit", async () => {
  const commit = "abcdef1234567890abcdef1234567890abcdef12";
  const statement = {
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { repository: "https://github.com/example/alpha", ref: "refs/tags/v1.2.3" } },
        resolvedDependencies: [{ uri: "git+https://github.com/example/alpha@refs/tags/v1.2.3", digest: { gitCommit: commit } }],
      },
    },
  };
  const document = packageDocument({ version: { dist: {
    signatures: [{ keyid: "key", sig: "sig" }],
    attestations: {
      url: "https://registry.npmjs.org/-/npm/v1/attestations/alpha@1.2.3",
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
    },
  } } });
  const fetch = async (url) => {
    if (url.includes("attestations")) return jsonResponse({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await verifyDirectPackage(item, document, structuredClone(DEFAULT_POLICY), {
    fetchImpl: fetch,
    remoteRefs: async () => [{ sha: commit, ref: "refs/tags/v1.2.3" }],
    now,
    timeoutMs: 100,
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.provenance, "slsa");
});

test("accepts branch-built provenance only when a version tag pins its commit", async () => {
  const commit = "abcdef1234567890abcdef1234567890abcdef12";
  const statement = {
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { repository: "https://github.com/example/alpha", ref: "refs/heads/main" } },
        resolvedDependencies: [{ uri: "git+https://github.com/example/alpha@refs/heads/main", digest: { gitCommit: commit } }],
      },
    },
  };
  const document = packageDocument({ version: { dist: {
    signatures: [{ keyid: "key", sig: "sig" }],
    attestations: {
      url: "https://registry.npmjs.org/-/npm/v1/attestations/alpha@1.2.3",
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
    },
  } } });
  const result = await verifyDirectPackage(item, document, structuredClone(DEFAULT_POLICY), {
    fetchImpl: async () => jsonResponse({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] }),
    remoteRefs: async () => [{ sha: commit, ref: "refs/tags/v1.2.3" }],
    now,
    timeoutMs: 100,
  });
  assert.deepEqual(result.failures, []);
});

test("rejects branch-built provenance when no version tag pins its commit", async () => {
  const commit = "abcdef1234567890abcdef1234567890abcdef12";
  const statement = {
    predicate: {
      buildDefinition: {
        externalParameters: { workflow: { repository: "https://github.com/example/alpha", ref: "refs/heads/main" } },
        resolvedDependencies: [{ uri: "git+https://github.com/example/alpha@refs/heads/main", digest: { gitCommit: commit } }],
      },
    },
  };
  const document = packageDocument({ version: { dist: {
    signatures: [{ keyid: "key", sig: "sig" }],
    attestations: {
      url: "https://registry.npmjs.org/-/npm/v1/attestations/alpha@1.2.3",
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
    },
  } } });
  const result = await verifyDirectPackage(item, document, structuredClone(DEFAULT_POLICY), {
    fetchImpl: async () => jsonResponse({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] }),
    remoteRefs: async () => [],
    now,
    timeoutMs: 100,
  });
  assert.ok(result.failures.some((message) => message.includes("no Git tag containing 1.2.3")));
});

test("fallback accepts an annotated version tag dereferenced to gitHead", async () => {
  const document = packageDocument();
  const gitHead = document.versions["1.2.3"].gitHead;
  const result = await verifyDirectPackage(item, document, structuredClone(DEFAULT_POLICY), {
    remoteRefs: async () => [{ sha: gitHead, ref: "refs/tags/v1.2.3^{}" }],
    now,
    timeoutMs: 100,
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.provenance, "gitHead-tag");
});

test("rejects direct lifecycle scripts and untrusted maintainers", async () => {
  const document = packageDocument({ version: { scripts: { postinstall: "node setup.js" }, maintainers: [{ name: "mallory" }] } });
  const policy = structuredClone(DEFAULT_POLICY);
  policy.trustedMaintainers.alpha = ["alice"];
  const result = await verifyDirectPackage(item, document, policy, {
    remoteRefs: async () => [{ sha: document.versions["1.2.3"].gitHead, ref: "refs/tags/alpha-1.2.3" }],
    now,
    timeoutMs: 100,
  });
  assert.ok(result.failures.some((message) => message.includes("lifecycle hook")));
  assert.ok(result.failures.some((message) => message.includes("registry maintainer set changed")));
});

test("rejects a missing previously trusted maintainer", async () => {
  const document = packageDocument({ version: { maintainers: [{ name: "alice" }] } });
  const policy = structuredClone(DEFAULT_POLICY);
  policy.trustedMaintainers.alpha = ["alice", "bob"];
  const gitHead = document.versions["1.2.3"].gitHead;
  const result = await verifyDirectPackage(item, document, policy, {
    remoteRefs: async () => [{ sha: gitHead, ref: "refs/tags/v1.2.3" }],
    now,
    timeoutMs: 100,
  });
  assert.ok(result.failures.some((message) => message.includes("registry maintainer set changed")));
});

test("accepts only a version-pinned unexpired source evidence exception", async () => {
  const document = packageDocument({ version: { gitHead: null } });
  const policy = structuredClone(DEFAULT_POLICY);
  policy.sourceEvidenceExceptions.alpha = {
    version: "1.2.3",
    reason: "Upstream does not publish version tags for this package.",
    expiresAt: "2025-02-01T00:00:00Z",
  };
  const result = await verifyDirectPackage(item, document, policy, { now, timeoutMs: 100 });
  assert.deepEqual(result.failures, []);
  assert.equal(result.provenance, "policy-exception");
  assert.ok(result.warnings.some((message) => message.includes("reviewed sourceEvidenceExceptions")));
});

test("rejects an expired source evidence exception", async () => {
  const document = packageDocument({ version: { gitHead: null } });
  const policy = structuredClone(DEFAULT_POLICY);
  policy.sourceEvidenceExceptions.alpha = {
    version: "1.2.3",
    reason: "Upstream does not publish version tags for this package.",
    expiresAt: "2024-12-31T00:00:00Z",
  };
  const result = await verifyDirectPackage(item, document, policy, { now, timeoutMs: 100 });
  assert.ok(result.failures.some((message) => message.includes("gitHead is missing")));
});
