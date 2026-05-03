/**
 * Inspect Hosthub GET /rentals and GET /rentals/{id}/channels (follows navigation.next).
 * Usage: HOSTHUB_API_TOKEN=... node scripts/hosthub-verify-channels.mjs [--raw]
 */
import { mapHosthubListingChannel } from "../packages/sync/dist/index.js";

const RAW = process.argv.includes("--raw");

const BASE = (process.env.HOSTHUB_API_BASE?.trim() || "https://app.hosthub.com/api/2019-03-01").replace(
  /\/+$/,
  "",
);
const token = process.env.HOSTHUB_API_TOKEN?.trim();
if (!token) {
  console.error("Set HOSTHUB_API_TOKEN");
  process.exit(1);
}

function pickChannelLabel(ch) {
  const bc = ch.base_channel;
  if (bc !== null && typeof bc === "object" && !Array.isArray(bc)) {
    const nm = bc.name;
    if (typeof nm === "string" && nm.trim().length > 0) return nm.trim();
  }
  if (typeof ch.name === "string" && ch.name.trim().length > 0) return ch.name.trim();
  return undefined;
}

function summarizeChannel(ch) {
  const o = {
    id: ch.id ?? null,
    object: ch.object ?? null,
    name: ch.name ?? null,
    base_channel: ch.base_channel
      ? { id: ch.base_channel.id ?? null, name: ch.base_channel.name ?? null }
      : null,
    url: ch.url ?? null,
  };
  return o;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: token,
      "User-Agent": "stay-ops-planner-hosthub-verify/0.2",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parseError: true, snippet: text.slice(0, 200) };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function fetchAllChannelRows(rentalId) {
  const rows = [];
  let next = `${BASE}/rentals/${encodeURIComponent(rentalId)}/channels`;
  let page = 0;
  const pageUrls = [];
  const seen = new Set();
  const maxPages = 50;
  while (next && page < maxPages) {
    if (seen.has(next)) {
      console.warn("  [pagination] repeated URL, stopping:", next.slice(0, 120));
      break;
    }
    seen.add(next);
    page += 1;
    pageUrls.push(next);
    const body = await getJson(next);
    const chunk = Array.isArray(body?.data) ? body.data : [];
    rows.push(...chunk);
    const navNext = body?.navigation?.next;
    next = typeof navNext === "string" && navNext.trim().length > 0 ? navNext.trim() : null;
  }
  if (page >= maxPages) {
    console.warn("  [pagination] maxPages reached");
  }
  return { rows, pages: page, pageUrls };
}

const rentalsBody = await getJson(`${BASE}/rentals`);
const rentals = Array.isArray(rentalsBody?.data) ? rentalsBody.data : [];
console.log("GET /rentals: count =", rentals.length);
if (rentalsBody?.navigation?.next) {
  console.log("NOTE: /rentals response has navigation.next — script only reads first page (same as many clients).");
  console.log("  next:", rentalsBody.navigation.next);
}

let totalChannelRows = 0;
const byMapped = { airbnb: 0, booking: 0, direct: 0 };

for (const rental of rentals) {
  const rid = typeof rental?.id === "string" ? rental.id.trim() : null;
  if (!rid) continue;
  const rname = typeof rental?.name === "string" ? rental.name : "?";

  const { rows, pages, pageUrls } = await fetchAllChannelRows(rid);
  totalChannelRows += rows.length;

  console.log("\n---", rname, "| rental.id:", rid, "| channel pages:", pages, "| rows:", rows.length);
  if (pages > 1) {
    console.log("  pagination URLs:", pageUrls.length);
  }
  let i = 0;
  for (const ch of rows) {
    i += 1;
    const label = pickChannelLabel(ch);
    const mapped = mapHosthubListingChannel(label);
    byMapped[mapped] = (byMapped[mapped] ?? 0) + 1;
    if (RAW) {
      console.log(`  [${i}] raw:`, JSON.stringify(ch, null, 2));
    } else {
      console.log(
        `  [${i}]`,
        JSON.stringify(summarizeChannel(ch)),
        "→ label",
        JSON.stringify(label ?? "(none)"),
        "→",
        mapped,
      );
    }
  }
}

console.log("\n=== summary ===");
console.log("channel rows (all pages, sum):", totalChannelRows);
console.log("mapped counts (from name/base_channel name):", byMapped);
const n = rentals.filter((r) => r?.id).length;
console.log("rentals on first /rentals page:", n);

console.log("\n--- interpretation ---");
console.log(
  "Unique channel *names* are usually 2 here (Airbnb + Booking.com). Hosthub may repeat the same rows on page 2; dedupe by channel id + stop on repeated navigation.next.",
);
console.log(
  "Direct stays (website/manual) appear in calendar-events' source field; they are not always a third row on GET .../channels.",
);
