import { resolve } from "node:path";
import { checkProject } from "./check.js";
import { initPolicy } from "./init.js";
import { loadPolicy } from "./policy.js";

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const command = argv.shift();
  if (!["check", "init"].includes(command)) throw new Error("expected command check or init; use --help for usage");
  const args = parseArgs(argv, command === "check" ? new Set(["path", "policy", "report", "skip-install"]) : new Set(["path", "output"]));
  if (!args.path) throw new Error("--path is required");
  if (command === "check") {
    if (!args.report) throw new Error("--report is required");
    const policy = await loadPolicy(args.policy ? resolve(args.policy) : null);
    const report = await checkProject({ path: args.path, report: args.report, policy, skipInstall: args["skip-install"] === true });
    console.log(`dependency-guard: ${report.status.toUpperCase()} - ${report.summary.directPackages} direct package(s), ${report.summary.failures} failure(s), ${report.summary.warnings} warning(s)`);
    console.log(`evidence: ${resolve(args.report)}`);
    for (const failure of report.failures.slice(0, 10)) console.error(`FAIL: ${failure}`);
    for (const warning of report.warnings.slice(0, 10)) console.warn(`WARN: ${warning}`);
    if (report.status !== "pass") process.exitCode = 1;
  } else {
    if (!args.output) throw new Error("--output is required");
    const result = await initPolicy({ path: args.path, output: args.output });
    console.log(`wrote policy: ${result.output}`);
    for (const warning of result.skipped) console.warn(`WARN: ${warning}`);
  }
}

function parseArgs(argv, allowed) {
  const result = {};
  while (argv.length) {
    const token = argv.shift();
    if (!token.startsWith("--")) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`unknown option: ${token}`);
    if (key === "skip-install") {
      if (result[key]) throw new Error(`${token} specified more than once`);
      result[key] = true;
      continue;
    }
    const value = argv.shift();
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    if (result[key]) throw new Error(`${token} specified more than once`);
    result[key] = value;
  }
  return result;
}

function printHelp() {
  console.log(`Usage:
  dependency-guard check --path <project> [--policy <policy.json>] --report <report.json> [--skip-install]
  dependency-guard init --path <project> --output <policy.json>`);
}
