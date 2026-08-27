import { readFile } from "node:fs/promises";
import { DEFAULT_POLICY } from "./constants.js";
import { normalizeRepository } from "./util.js";

const KEYS = new Set(Object.keys(DEFAULT_POLICY));

export async function loadPolicy(file) {
  if (!file) return structuredClone(DEFAULT_POLICY);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read policy ${file}: ${error.message}`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("policy must be a JSON object");
  }
  for (const key of Object.keys(parsed)) {
    if (!KEYS.has(key)) throw new Error(`unknown policy key: ${key}`);
  }
  const policy = { ...structuredClone(DEFAULT_POLICY), ...parsed };
  validateVersionExceptions(policy.allowInstallScripts, "allowInstallScripts");
  validateVersionExceptions(policy.allowDirectLifecycleScripts, "allowDirectLifecycleScripts");
  validateArchiveExceptions(policy.archiveSizeExceptions);
  validateSourceExceptions(policy.sourceEvidenceExceptions);
  validateMap(policy, "trustedRepositories", false);
  validateMap(policy, "trustedMaintainers", true);
  if (!["fail", "warn"].includes(policy.freshReleaseAction)) {
    throw new Error("freshReleaseAction must be fail or warn");
  }
  for (const key of ["minimumReleaseAgeHours", "maxTarballSizeBytes", "maxUnpackedSizeBytes"]) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new Error(`${key} must be a non-negative number`);
  }
  for (const [name, repository] of Object.entries(policy.trustedRepositories)) {
    if (!normalizeRepository(repository)) throw new Error(`trustedRepositories.${name} must be a GitHub repository URL`);
  }
  return policy;
}

function validateSourceExceptions(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("sourceEvidenceExceptions must be an object");
  }
  for (const [name, exception] of Object.entries(value)) {
    if (!name || !exception || Array.isArray(exception) || typeof exception !== "object") {
      throw new Error(`invalid sourceEvidenceExceptions entry for ${name || "<empty>"}`);
    }
    const keys = Object.keys(exception);
    if (keys.some((key) => !["version", "reason", "expiresAt"].includes(key))) {
      throw new Error(`unknown sourceEvidenceExceptions field for ${name}`);
    }
    if (typeof exception.version !== "string" || !exception.version) {
      throw new Error(`sourceEvidenceExceptions.${name}.version must be a non-empty string`);
    }
    if (typeof exception.reason !== "string" || exception.reason.trim().length < 20) {
      throw new Error(`sourceEvidenceExceptions.${name}.reason must contain at least 20 characters`);
    }
    if (typeof exception.expiresAt !== "string" || !Number.isFinite(Date.parse(exception.expiresAt))) {
      throw new Error(`sourceEvidenceExceptions.${name}.expiresAt must be an ISO date`);
    }
  }
}

function validateVersionExceptions(value, key) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${key} must be an object`);
  for (const [name, exception] of Object.entries(value)) {
    validateExceptionBase(name, exception, key, ["versions"]);
    if (!Array.isArray(exception.versions) || exception.versions.length === 0 || exception.versions.some((version) => typeof version !== "string" || !version)) {
      throw new Error(`${key}.${name}.versions must be an array of non-empty strings`);
    }
  }
}

function validateArchiveExceptions(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("archiveSizeExceptions must be an object");
  for (const [name, exception] of Object.entries(value)) {
    validateExceptionBase(name, exception, "archiveSizeExceptions", ["version", "maxTarballSizeBytes", "maxUnpackedSizeBytes"]);
    if (typeof exception.version !== "string" || !exception.version) throw new Error(`archiveSizeExceptions.${name}.version must be a non-empty string`);
    const limits = [exception.maxTarballSizeBytes, exception.maxUnpackedSizeBytes].filter((limit) => limit !== undefined);
    if (limits.length === 0 || limits.some((limit) => !Number.isFinite(limit) || limit < 0)) {
      throw new Error(`archiveSizeExceptions.${name} must contain at least one non-negative size limit`);
    }
  }
}

function validateExceptionBase(name, exception, key, allowedFields) {
  if (!name || !exception || Array.isArray(exception) || typeof exception !== "object") {
    throw new Error(`invalid ${key} entry for ${name || "<empty>"}`);
  }
  if (Object.keys(exception).some((field) => ![...allowedFields, "reason", "expiresAt"].includes(field))) {
    throw new Error(`unknown ${key} field for ${name}`);
  }
  if (typeof exception.reason !== "string" || exception.reason.trim().length < 20) {
    throw new Error(`${key}.${name}.reason must contain at least 20 characters`);
  }
  if (typeof exception.expiresAt !== "string" || !Number.isFinite(Date.parse(exception.expiresAt))) {
    throw new Error(`${key}.${name}.expiresAt must be an ISO date`);
  }
}

function validateMap(policy, key, arrays) {
  const value = policy[key];
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${key} must be an object`);
  for (const [name, entry] of Object.entries(value)) {
    if (!name || (arrays ? !Array.isArray(entry) || entry.some((item) => typeof item !== "string") : typeof entry !== "string")) {
      throw new Error(`invalid ${key} entry for ${name || "<empty>"}`);
    }
  }
}
