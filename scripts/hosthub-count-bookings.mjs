/**
 * Paginate Hosthub GET /calendar-events (or HOSTHUB_API_RESERVATIONS_PATH), count Booking vs Hold rows.
 * Loads repo-root `.env.hosthub.local` when vars are unset (same pattern as hosthub-smoke).
 *
 * Usage:
 *   pnpm hosthub:count-bookings
 *   pnpm hosthub:count-bookings -- --overlap-year 2026
 *
 * Compare `--overlap-year` totals to `GET /api/excel/listings?year=<same>` (same UTC overlap rule as the app).
 *
 * Requires HOSTHUB_API_TOKEN (in env or .env.hosthub.local). Never pass tokens on the command line.
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
        "  pnpm hosthub:smoke\n" +
        "  pnpm hosthub:count-bookings",
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

/** Parse YYYY-MM-DD prefix from Hosthub date strings (sync uses exclusive checkout). */
function parseDateOnlyUtc(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function pickDateFrom(row, keys) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim().length > 0) {
      return parseDateOnlyUtc(v);
    }
  }
  return null;
}

function pickCheckinCheckout(row) {
  const checkin = pickDateFrom(row, [
    "date_from",
    "dateFrom",
    "checkIn",
    "check_in",
    "arrival",
    "checkin_date",
    "start_date",
    "from",
  ]);
  const checkout = pickDateFrom(row, [
    "date_to",
    "dateTo",
    "checkOut",
    "check_out",
    "departure",
    "checkout_date",
    "end_date",
    "to",
  ]);
  return { checkin, checkout };
}

/** Same rule as apps/web bookingOverlapsUtcCalendarYearWhere + prisma @db.Date semantics. */
function stayOverlapsUtcCalendarYear(checkin, checkout, year) {
  if (!checkin || !checkout) return false;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  return checkin.getTime() < nextYearStart.getTime() && checkout.getTime() > yearStart.getTime();
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

const baseUrl = normalizeBaseUrl(
  process.env.HOSTHUB_API_BASE?.trim() || "https://app.hosthub.com/api/2019-03-01",
);
const parsedBase = new URL(baseUrl);
const baseOrigin = parsedBase.origin;
const basePathPrefix = parsedBase.pathname.replace(/\/+$/, "");

const listReservationsPathRaw = process.env.HOSTHUB_API_RESERVATIONS_PATH?.trim() || "/calendar-events";
const listReservationsPath = listReservationsPathRaw.startsWith("/")
  ? listReservationsPathRaw
  : `/${listReservationsPathRaw}`;

const token = process.env.HOSTHUB_API_TOKEN?.trim();
if (!token) {
  console.error("HOSTHUB_API_TOKEN is empty (set in environment or .env.hosthub.local)");
  process.exit(1);
}

let overlapYear = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--overlap-year") {
    const y = Number(argv[i + 1]);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      console.error("Invalid --overlap-year (expect integer 2000–2100)");
      process.exit(1);
    }
    overlapYear = y;
    i += 1;
  }
}

const isVisibleFirst = process.env.HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE?.trim() || "";

/**
 * @param {string} nextPageUrl
 * @returns {string}
 */
function resolveRequestUrl(nextPageUrl) {
  const t = nextPageUrl.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) {
    return t;
  }
  if (t.startsWith("?")) {
    const baseListPath = listReservationsPath.startsWith("/")
      ? `${basePathPrefix}${listReservationsPath}`
      : `${basePathPrefix}/${listReservationsPath}`;
    const u = new URL(baseListPath, baseOrigin);
    u.search = t;
    return u.toString();
  }
  if (t.startsWith("/")) {
    if (basePathPrefix && t.startsWith(`${basePathPrefix}/`)) {
      return new URL(t, baseOrigin).toString();
    }
    if (basePathPrefix && !t.startsWith("/api/")) {
      return new URL(`${basePathPrefix}${t}`, baseOrigin).toString();
    }
    return new URL(t, baseOrigin).toString();
  }
  return new URL(t, `${baseUrl}/`).toString();
}

function firstListUrl() {
  const firstPath = listReservationsPath.startsWith("/")
    ? `${basePathPrefix}${listReservationsPath}`
    : `${basePathPrefix}/${listReservationsPath}`;
  const url = new URL(firstPath, baseOrigin);
  url.searchParams.set("updated_gte", "0");
  if (isVisibleFirst) {
    url.searchParams.set("is_visible", isVisibleFirst);
  }
  return url.toString();
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: token,
      "User-Agent": "stay-ops-planner-hosthub-count-bookings/0.2",
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parseError: true, snippet: text.slice(0, 400) };
  }
  if (!res.ok) {
    console.error("Hosthub request failed", { status: res.status, url: url.slice(0, 120), body });
    process.exit(1);
  }
  return body;
}

const MAX_PAGES = 500;
const seen = new Set();
let pages = 0;
let rowsTotal = 0;
let bookings = 0;
let holds = 0;
let rowsOverlapYear = 0;
let bookingsOverlapYear = 0;
let holdsOverlapYear = 0;
let truncated = false;

let nextUrl = firstListUrl();

for (;;) {
  if (seen.has(nextUrl)) {
    console.warn("Stopped: repeated pagination URL");
    break;
  }
  seen.add(nextUrl);
  pages += 1;
  if (pages > MAX_PAGES) {
    truncated = true;
    break;
  }

  const body = await fetchPage(nextUrl);
  const data = Array.isArray(body?.data) ? body.data : [];
  rowsTotal += data.length;

  for (const row of data) {
    const typeRaw =
      row && typeof row === "object" && !Array.isArray(row) && typeof row.type === "string"
        ? row.type
        : "";
    const isHold = typeRaw.toLowerCase() === "hold";

    if (isHold) {
      holds += 1;
    } else {
      bookings += 1;
    }

    if (overlapYear !== null) {
      const { checkin, checkout } = pickCheckinCheckout(row);
      const overlaps = stayOverlapsUtcCalendarYear(checkin, checkout, overlapYear);
      if (overlaps) {
        rowsOverlapYear += 1;
        if (isHold) {
          holdsOverlapYear += 1;
        } else {
          bookingsOverlapYear += 1;
        }
      }
    }
  }

  const navNext = body?.navigation?.next;
  const rawNext = typeof navNext === "string" && navNext.trim().length > 0 ? navNext.trim() : null;
  if (!rawNext) {
    break;
  }
  nextUrl = resolveRequestUrl(rawNext);
}

const out = {
  pages,
  rows_total: rowsTotal,
  bookings,
  holds,
  truncated,
  list_path: listReservationsPath,
  is_visible_first_page: isVisibleFirst || null,
  compare_to_app:
    overlapYear !== null
      ? `GET /api/excel/listings?year=${overlapYear} sums bookingCount per source_listing with the same UTC overlap rule (check-out exclusive).`
      : "Re-run with --overlap-year YYYY to compare Hosthub payloads to the Settings table for that year.",
};

if (overlapYear !== null) {
  out.overlap_year = overlapYear;
  out.api_rows_overlap_year = rowsOverlapYear;
  out.api_bookings_overlap_year = bookingsOverlapYear;
  out.api_holds_overlap_year = holdsOverlapYear;
}

console.log(JSON.stringify(out, null, 2));
