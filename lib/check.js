import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { COMMAND_TIMEOUT_MS, HTTP_TIMEOUT_MS, REPORT_VERSION } from "./constants.js";
import { inspectLock, readProject } from "./project.js";
import { fetchPackageDocument, verifyDirectPackage } from "./verify.js";
import { redact, runCommand } from "./util.js";

export async function checkProject(options, injected = {}) {
  const projectPath = resolve(options.path);
  const run = injected.run ?? runCommand;
  const dependencies = {
    fetchImpl: injected.fetch ?? globalThis.fetch,
    remoteRefs: injected.remoteRefs,
    run,
    now: injected.now ?? Date.now,
    timeoutMs: options.httpTimeoutMs ?? HTTP_TIMEOUT_MS,
  };
  const report = {
    reportVersion: REPORT_VERSION,
    generatedAt: new Date(dependencies.now()).toISOString(),
    projectPath,
    status: "fail",
    summary: {},
    lockfile: {},
    packages: [],
    commands: [],
    failures: [],
    warnings: [],
  };

  try {
    const project = await readProject(projectPath);
    const lockInspection = inspectLock(project.lock, options.policy);
    report.lockfile = { lockfileVersion: project.lock.lockfileVersion, registryEntries: lockInspection.registryEntries };
    report.failures.push(...lockInspection.failures.map((message) => `lockfile: ${message}`));

    for (const item of project.direct) {
      try {
        const document = await fetchPackageDocument(item.name, dependencies);
        const packageResult = await verifyDirectPackage(item, document, options.policy, dependencies);
        const pack = await execute(run, "npm", ["pack", `${item.name}@${item.version}`, "--dry-run", "--json", "--ignore-scripts"], projectPath, options.commandTimeoutMs, 25_000_000);
        report.commands.push(pack.evidence);
        if (pack.result.code !== 0) {
          packageResult.failures.push(`npm pack failed${pack.result.timedOut ? " (timed out)" : ""}`);
        } else {
          try {
            const packed = JSON.parse(pack.result.stdout)[0];
            packageResult.tarballSizeBytes = packed.size;
            packageResult.unpackedSizeBytes = packed.unpackedSize;
            if (!Number.isFinite(packed.size) || packed.size > options.policy.maxTarballSizeBytes) packageResult.failures.push(`tarball size ${packed.size ?? "unknown"} exceeds ${options.policy.maxTarballSizeBytes}`);
            if (!Number.isFinite(packed.unpackedSize) || packed.unpackedSize > options.policy.maxUnpackedSizeBytes) packageResult.failures.push(`unpacked size ${packed.unpackedSize ?? "unknown"} exceeds ${options.policy.maxUnpackedSizeBytes}`);
          } catch {
            packageResult.failures.push("npm pack returned invalid JSON evidence");
          }
        }
        report.packages.push(packageResult);
      } catch (error) {
        report.packages.push({ name: item.name, version: item.version, dev: item.dev, failures: [error.message], warnings: [] });
      }
    }

    if (!options.skipInstall) {
      for (const args of [
        ["ci", "--ignore-scripts"],
        ["audit", "signatures"],
        ["audit", "--omit=dev"],
      ]) {
        const command = await execute(run, "npm", args, projectPath, options.commandTimeoutMs);
        report.commands.push(command.evidence);
        if (command.result.code !== 0) report.failures.push(`npm ${args.join(" ")} failed${command.result.timedOut ? " (timed out)" : ""}`);
        if (command.result.code !== 0 && args[0] === "ci") break;
      }
    }
  } catch (error) {
    report.failures.push(error.message);
  }

  for (const item of report.packages) {
    report.failures.push(...item.failures.map((message) => `${item.name}@${item.version}: ${message}`));
    report.warnings.push(...item.warnings.map((message) => `${item.name}@${item.version}: ${message}`));
  }
  report.status = report.failures.length ? "fail" : "pass";
  report.summary = {
    directPackages: report.packages.length,
    failures: report.failures.length,
    warnings: report.warnings.length,
    commands: report.commands.length,
  };
  await mkdir(dirname(resolve(options.report)), { recursive: true });
  await writeFile(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function execute(run, command, args, cwd, timeoutMs = COMMAND_TIMEOUT_MS, maxOutputBytes = 20_000) {
  const result = await run(command, args, { cwd, timeoutMs, maxOutputBytes });
  return {
    result,
    evidence: {
      command: [command, ...args].join(" "),
      exitCode: result.code,
      timedOut: Boolean(result.timedOut),
      stdout: redact(result.stdout ?? ""),
      stderr: redact(result.stderr ?? ""),
    },
  };
}
