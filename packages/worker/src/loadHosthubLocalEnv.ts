import fs from "node:fs";
import path from "node:path";

const FILE = ".env.hosthub.local";

/**
 * Walks up from cwd (a few levels) for repo-root `.env.hosthub.local` and merges into `process.env`
 * without overwriting existing keys (so Docker / shell wins).
 */
export function loadHosthubLocalEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, FILE);
    if (fs.existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
}

function applyEnvFile(filePath: string): void {
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
