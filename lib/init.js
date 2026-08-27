import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_POLICY, HTTP_TIMEOUT_MS } from "./constants.js";
import { readProject } from "./project.js";
import { fetchPackageDocument } from "./verify.js";
import { normalizeRepository } from "./util.js";

export async function initPolicy(options, injected = {}) {
  const project = await readProject(resolve(options.path));
  const policy = structuredClone(DEFAULT_POLICY);
  const skipped = [];
  const dependencies = { fetchImpl: injected.fetch ?? globalThis.fetch, timeoutMs: options.httpTimeoutMs ?? HTTP_TIMEOUT_MS };
  for (const item of project.direct) {
    const document = await fetchPackageDocument(item.name, dependencies);
    const versionData = document.versions?.[item.version];
    if (!versionData) throw new Error(`${item.name}@${item.version} is absent from npm registry metadata`);
    const repository = normalizeRepository(versionData.repository ?? document.repository);
    if (!repository) {
      skipped.push(`${item.name}@${item.version}: no GitHub repository; not trusted`);
      continue;
    }
    policy.trustedRepositories[item.name] = repository;
    const maintainers = (versionData.maintainers ?? document.maintainers ?? []).map((entry) => entry.name).filter(Boolean).sort();
    if (maintainers.length) policy.trustedMaintainers[item.name] = [...new Set(maintainers)];
  }
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(policy, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { policy, skipped, output };
}
