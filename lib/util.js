import { spawn } from "node:child_process";

export function normalizeRepository(value) {
  if (!value) return null;
  let raw = typeof value === "string" ? value : value.url;
  if (typeof raw !== "string") return null;
  raw = raw.trim()
    .replace(/^github:/i, "https://github.com/")
    .replace(/^github\.com\//i, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/^git@github\.com:/i, "https://github.com/");
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").split("/");
    if (parts.length !== 2 || !parts.every(Boolean)) return null;
    return `https://github.com/${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
  } catch {
    return null;
  }
}

export function repositorySlug(repository) {
  return normalizeRepository(repository)?.slice("https://github.com/".length) ?? null;
}

export function packageNameFromLockPath(lockPath, entry) {
  if (typeof entry.name === "string") return entry.name;
  const match = lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  return match?.[1] ?? null;
}

export function redact(value) {
  return String(value)
    .replace(/(authorization|_?authToken|token|password|secret|npm_[a-z0-9_]*token)\s*[:=]\s*[^\s,]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/https:\/\/[^\s/@]+@/gi, "https://[REDACTED]@")
    .slice(0, 20_000);
}

export async function fetchJson(url, options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 15_000, headers = {} } = options;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${safeUrl(url)}`);
  return response.json();
}

export function safeUrl(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  return url.toString();
}

export function runCommand(command, args, options = {}) {
  const { cwd, timeoutMs = 120_000, maxOutputBytes = 20_000 } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk, maxOutputBytes); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk, maxOutputBytes); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function appendBounded(current, chunk, limit) {
  if (current.length >= limit) return current;
  return current + String(chunk).slice(0, limit - current.length);
}

export function decodeBase64Json(value) {
  if (typeof value !== "string") throw new Error("attestation payload is missing");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}
