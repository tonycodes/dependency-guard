import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { packageNameFromLockPath } from "./util.js";

export async function readProject(projectPath) {
  const manifest = await readJson(join(projectPath, "package.json"), "package.json");
  const lock = await readJson(join(projectPath, "package-lock.json"), "package-lock.json");
  if (![2, 3].includes(lock.lockfileVersion)) throw new Error("package-lock.json must use lockfileVersion 2 or 3");
  if (!lock.packages || typeof lock.packages !== "object") throw new Error("package-lock.json has no packages map");

  const requested = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  const direct = [];
  for (const name of Object.keys(requested).sort()) {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry || typeof entry.version !== "string" || entry.link) {
      throw new Error(`cannot resolve exact direct version for ${name} from package-lock.json`);
    }
    direct.push({ name, version: entry.version, dev: name in (manifest.devDependencies ?? {}) });
  }
  return { manifest, lock, direct };
}

export function inspectLock(lock, policy, now = Date.now()) {
  const failures = [];
  let registryEntries = 0;
  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (!lockPath || entry.link) continue;
    const name = packageNameFromLockPath(lockPath, entry) ?? lockPath;
    const scriptException = policy.allowInstallScripts[name];
    const scriptAllowed = scriptException?.versions.includes(entry.version) && Date.parse(scriptException.expiresAt) > now;
    if (entry.hasInstallScript && !scriptAllowed) {
      failures.push(`${name}@${entry.version ?? "unknown"}: lock entry declares hasInstallScript; add a reviewed, version-pinned allowInstallScripts exception if intentional`);
    }
    if (!lockPath.includes("node_modules/")) continue;
    registryEntries += 1;
    if (typeof entry.integrity !== "string" || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(entry.integrity)) {
      failures.push(`${name}: lock entry has no valid sha256/sha384/sha512 integrity`);
    }
    try {
      const resolved = new URL(entry.resolved);
      if (resolved.protocol !== "https:" || resolved.hostname !== "registry.npmjs.org") {
        failures.push(`${name}: lock entry is not resolved from https://registry.npmjs.org`);
      }
    } catch {
      failures.push(`${name}: lock entry has no valid registry resolved URL`);
    }
  }
  return { failures, registryEntries };
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot parse ${label}: ${error.message}`);
  }
}
