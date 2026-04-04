/**
 * One-shot Hosthub API check: GET /calendar-events (same auth/path as sync client).
 * Loads vars from repo-root `.env.hosthub.local` only (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.hosthub.local");

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(
      `Missing: ${filePath}\n` +
        "Copy .env.hosthub.example to .env.hosthub.local, set HOSTHUB_API_TOKEN, then run:\n" +
        "  pnpm hosthub:smoke",
    );
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
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

loadLocalEnvFile(envPath);

const token = process.env.HOSTHUB_API_TOKEN?.trim();
const base = (process.env.HOSTHUB_API_BASE?.trim() || "https://app.hosthub.com/api/2019-03-01").replace(
  /\/+$/,
  "",
);

if (!token) {
  console.error("HOSTHUB_API_TOKEN is empty in .env.hosthub.local");
  process.exit(1);
}

const url = `${base}/calendar-events?updated_gte=0`;
const res = await fetch(url, {
  headers: {
    Accept: "application/json",
    Authorization: token,
    "User-Agent": "stay-ops-planner-hosthub-smoke/0.1",
  },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { _parseError: true, snippet: text.slice(0, 400) };
}

if (!res.ok) {
  console.error("Hosthub request failed", { status: res.status, body });
  process.exit(1);
}

const data = body?.data;
const n = Array.isArray(data) ? data.length : 0;
const hasNext = Boolean(body?.navigation?.next);
console.log("Hosthub OK:", res.status, "| first_page_events:", n, "| navigation.next:", hasNext ? "yes" : "no");
