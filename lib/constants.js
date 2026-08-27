export const DEFAULT_POLICY = Object.freeze({
  allowInstallScripts: {},
  allowDirectLifecycleScripts: {},
  archiveSizeExceptions: {},
  sourceEvidenceExceptions: {},
  trustedRepositories: {},
  trustedMaintainers: {},
  minimumReleaseAgeHours: 72,
  freshReleaseAction: "warn",
  maxTarballSizeBytes: 20 * 1024 * 1024,
  maxUnpackedSizeBytes: 100 * 1024 * 1024,
});

export const HTTP_TIMEOUT_MS = 15_000;
export const COMMAND_TIMEOUT_MS = 120_000;
export const REPORT_VERSION = 1;
