import { decodeBase64Json, fetchJson, normalizeRepository, runCommand } from "./util.js";

export async function fetchPackageDocument(name, dependencies) {
  return fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`, dependencies);
}

export async function verifyDirectPackage(item, document, policy, dependencies) {
  const failures = [];
  const warnings = [];
  const versionData = document.versions?.[item.version];
  if (!versionData) return result(item, failures.concat("exact version is absent from npm registry metadata"), warnings);

  const signatures = versionData.dist?.signatures;
  if (!Array.isArray(signatures) || signatures.length === 0 || signatures.some((entry) => !entry.keyid || !entry.sig)) {
    failures.push("npm registry metadata has no valid registry signature");
  }

  const actualRepository = normalizeRepository(versionData.repository ?? document.repository);
  const configuredRepository = policy.trustedRepositories[item.name]
    ? normalizeRepository(policy.trustedRepositories[item.name])
    : null;
  if (configuredRepository && actualRepository !== configuredRepository) {
    failures.push(`repository mismatch: expected ${configuredRepository}, registry reports ${actualRepository ?? "no GitHub repository"}`);
  }
  const repository = configuredRepository ?? actualRepository;
  if (!repository) failures.push("no verifiable GitHub upstream repository is available");

  const trustedMaintainers = policy.trustedMaintainers[item.name];
  if (trustedMaintainers) {
    const actual = [...new Set((versionData.maintainers ?? document.maintainers ?? []).map((entry) => entry.name?.toLowerCase()).filter(Boolean))].sort();
    const trusted = [...new Set(trustedMaintainers.map((entry) => entry.toLowerCase()))].sort();
    if (actual.length === 0) failures.push("registry metadata has no maintainers to compare with policy");
    if (actual.join("\n") !== trusted.join("\n")) {
      failures.push(`registry maintainer set changed: expected ${trusted.join(", ")}; found ${actual.join(", ") || "none"}`);
    }
  }

  const lifecycle = ["preinstall", "install", "postinstall"].filter((name) => versionData.scripts?.[name]);
  const lifecycleException = policy.allowDirectLifecycleScripts[item.name];
  const lifecycleAllowed = lifecycleException?.versions.includes(item.version) && Date.parse(lifecycleException.expiresAt) > dependencies.now();
  if (lifecycle.length && !lifecycleAllowed) {
    failures.push(`direct package declares lifecycle hook(s): ${lifecycle.join(", ")}`);
  }

  const publishedAt = document.time?.[item.version];
  let releaseAgeHours = null;
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) {
    warnings.push("registry metadata has no valid release timestamp");
  } else {
    releaseAgeHours = (dependencies.now() - Date.parse(publishedAt)) / 3_600_000;
    if (releaseAgeHours < policy.minimumReleaseAgeHours) {
      const message = `release is ${Math.max(0, releaseAgeHours).toFixed(1)} hours old; policy requires ${policy.minimumReleaseAgeHours}`;
      (policy.freshReleaseAction === "fail" ? failures : warnings).push(message);
    }
  }

  let provenance = "none";
  if (repository) {
    const attestations = versionData.dist?.attestations;
    const provenanceUrl = attestations?.provenance?.predicateType === "https://slsa.dev/provenance/v1"
      ? attestations.url
      : attestations?.provenance?.url;
    if (provenanceUrl) {
      provenance = "slsa";
      try {
        if (new URL(provenanceUrl).protocol !== "https:") throw new Error("attestation URL is not HTTPS");
        await verifyProvenance(provenanceUrl, item, repository, dependencies);
      } catch (error) {
        const message = `SLSA provenance: ${error.message}`;
        if (hasValidSourceException(item, policy, dependencies)) {
          provenance = "policy-exception";
          warnings.push(`${message}; accepted by reviewed sourceEvidenceExceptions policy`);
        } else {
          failures.push(message);
        }
      }
    } else {
      provenance = "gitHead-tag";
      try {
        await verifyGitFallback(versionData.gitHead, item, repository, dependencies);
      } catch (error) {
        const message = `git fallback: ${error.message}`;
        if (hasValidSourceException(item, policy, dependencies)) {
          provenance = "policy-exception";
          warnings.push(`${message}; accepted by reviewed sourceEvidenceExceptions policy`);
        } else {
          failures.push(message);
        }
      }
    }
  }
  return { ...result(item, failures, warnings), repository, releaseAgeHours, provenance, maintainers: (versionData.maintainers ?? document.maintainers ?? []).map((entry) => entry.name).filter(Boolean) };
}

async function verifyProvenance(url, item, repository, dependencies) {
  const data = await fetchJson(url, dependencies);
  const attestations = data.attestations ?? (data.bundle ? [data] : []);
  const attestation = attestations.find((entry) => String(entry.predicateType ?? "").includes("slsa")) ?? attestations[0];
  const envelope = attestation?.bundle?.dsseEnvelope ?? attestation?.dsseEnvelope;
  const statement = decodeBase64Json(envelope?.payload);
  const predicate = statement.predicate ?? {};
  const workflow = predicate.buildDefinition?.externalParameters?.workflow ?? predicate.invocation?.configSource ?? {};
  const sourceRepository = normalizeRepository(workflow.repository ?? workflow.uri);
  const sourceRef = workflow.ref ?? workflow.digest?.ref;
  const dependenciesList = predicate.buildDefinition?.resolvedDependencies ?? predicate.materials ?? [];
  const source = dependenciesList.find((entry) => normalizeProvenanceRepository(entry.uri) === normalizeRepository(repository));
  const commit = source?.digest?.gitCommit ?? source?.digest?.sha1;
  const resolvedRef = provenanceRef(source?.uri) ?? sourceRef;
  if (sourceRepository !== normalizeRepository(repository)) throw new Error(`source repository mismatch (${sourceRepository ?? "missing"})`);
  if (!/^[0-9a-f]{7,64}$/i.test(commit ?? "")) throw new Error("source commit is missing");
  if (typeof resolvedRef !== "string" || !resolvedRef.startsWith("refs/")) throw new Error("resolved source ref is missing");
  if (resolvedRef.startsWith("refs/tags/")) {
    await requireRemoteTag(repository, resolvedRef, commit, dependencies);
  } else {
    await requireVersionTag(repository, item.version, commit, dependencies);
  }
}

function normalizeProvenanceRepository(value) {
  if (typeof value !== "string") return normalizeRepository(value);
  return normalizeRepository(value.replace(/@refs\/(?:tags|heads)\/.*$/, ""));
}

async function verifyGitFallback(gitHead, item, repository, dependencies) {
  if (!/^[0-9a-f]{7,64}$/i.test(gitHead ?? "")) throw new Error("npm gitHead is missing or invalid");
  const refs = await listRemoteTags(repository, `refs/tags/*${item.version}*`, dependencies);
  const found = refs.some((ref) => ref.sha.toLowerCase() === gitHead.toLowerCase());
  if (!found) throw new Error(`no Git tag containing ${item.version} points to npm gitHead`);
}

async function requireRemoteTag(repository, ref, commit, dependencies) {
  const refs = await listRemoteTags(repository, ref, dependencies);
  if (!refs.some((entry) => entry.sha.toLowerCase() === commit.toLowerCase())) {
    throw new Error(`${ref} does not point to provenance commit`);
  }
}

async function requireVersionTag(repository, version, commit, dependencies) {
  const refs = await listRemoteTags(repository, `refs/tags/*${version}*`, dependencies);
  if (!refs.some((entry) => entry.sha.toLowerCase() === commit.toLowerCase())) {
    throw new Error(`no Git tag containing ${version} points to provenance commit`);
  }
}

async function listRemoteTags(repository, pattern, dependencies) {
  if (dependencies.remoteRefs) return dependencies.remoteRefs(repository, pattern);
  const run = dependencies.run ?? runCommand;
  const result = await run("git", ["ls-remote", "--tags", `${repository}.git`, pattern, `${pattern}^{}`], {
    timeoutMs: dependencies.timeoutMs,
    maxOutputBytes: 2_000_000,
  });
  if (result.code !== 0) throw new Error(`git ls-remote failed: ${result.stderr || `exit ${result.code}`}`);
  return String(result.stdout).split("\n").filter(Boolean).map((line) => {
    const [sha, ref] = line.split(/\s+/, 2);
    return { sha, ref };
  });
}

function provenanceRef(value) {
  if (typeof value !== "string") return null;
  return value.match(/@(refs\/(?:tags|heads)\/.*)$/)?.[1] ?? null;
}

function hasValidSourceException(item, policy, dependencies) {
  const exception = policy.sourceEvidenceExceptions[item.name];
  return exception?.version === item.version && Date.parse(exception.expiresAt) > dependencies.now();
}

function result(item, failures, warnings) {
  return { name: item.name, version: item.version, dev: item.dev, failures, warnings };
}
