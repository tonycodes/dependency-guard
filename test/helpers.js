import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function makeProject(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dependency-guard-test-"));
  const manifest = overrides.manifest ?? {
    name: "fixture",
    version: "1.0.0",
    dependencies: { alpha: "^1.0.0" },
  };
  const alphaEntry = {
    version: "1.2.3",
    resolved: "https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz",
    integrity: `sha512-${Buffer.from("integrity").toString("base64")}`,
    ...overrides.alphaEntry,
  };
  const lock = overrides.lock ?? {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: { "": { name: "fixture", version: "1.0.0" }, "node_modules/alpha": alphaEntry },
  };
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "package-lock.json"), JSON.stringify(lock));
  return directory;
}

export function packageDocument(overrides = {}) {
  const version = {
    name: "alpha",
    version: "1.2.3",
    repository: { type: "git", url: "git+https://github.com/example/alpha.git" },
    maintainers: [{ name: "alice" }],
    dist: { signatures: [{ keyid: "SHA256:key", sig: "signature" }] },
    gitHead: "abcdef1234567890abcdef1234567890abcdef12",
    ...overrides.version,
  };
  version.dist = { signatures: [{ keyid: "SHA256:key", sig: "signature" }], ...overrides.version?.dist };
  return {
    name: "alpha",
    maintainers: [{ name: "alice" }],
    time: { "1.2.3": "2024-01-01T00:00:00.000Z" },
    versions: { "1.2.3": version },
    ...overrides.document,
  };
}

export function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

export function passingRun(calls = []) {
  return async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "pack") return { code: 0, stdout: JSON.stringify([{ size: 100, unpackedSize: 500 }]), stderr: "", timedOut: false };
    return { code: 0, stdout: "ok", stderr: "", timedOut: false };
  };
}
