/**
 * A small iCalendar (RFC 5545) writer for the phone calendar feed: all-day events, an optional reminder,
 * nothing else. Kept free of the database so it can be tested on its own.
 */

export type IcsAllDayEvent = {
  /** Stable across fetches, so the phone updates the event instead of adding a copy. */
  uid: string;
  /** YYYY-MM-DD; the event covers that one day. */
  date: string;
  summary: string;
  description?: string | undefined;
  lastModified: Date;
  /** Minutes before the start of the day (00:00) to remind; 15 * 60 is 09:00 the day before. */
  alarmMinutesBefore?: number | undefined;
};

export type IcsCalendar = {
  name: string;
  /** How often calendar apps should check for changes, in minutes. Apps may check less often. */
  refreshMinutes: number;
  events: IcsAllDayEvent[];
  now: Date;
};

/** TEXT values: backslash, semicolon, comma and line breaks are escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Lines longer than 75 bytes are folded (CRLF and a space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // The first line holds 75 bytes; each continuation line starts with a space, so it holds 74 more.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function dateValue(iso: string): string {
  return iso.replace(/-/g, "");
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function utcStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `PT${hours > 0 ? `${hours}H` : ""}${rest > 0 || hours === 0 ? `${rest}M` : ""}`;
}

function eventLines(event: IcsAllDayEvent, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `LAST-MODIFIED:${utcStamp(event.lastModified)}`,
    `DTSTART;VALUE=DATE:${dateValue(event.date)}`,
    `DTEND;VALUE=DATE:${dateValue(nextDay(event.date))}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  // An all-day booking event must not show the day as busy in the phone owner's own calendar.
  lines.push("TRANSP:TRANSPARENT");
  if (event.alarmMinutesBefore !== undefined) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.summary)}`,
      `TRIGGER:-${duration(event.alarmMinutesBefore)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** The whole feed, CRLF line endings as the format requires. */
export function buildIcs(calendar: IcsCalendar): string {
  const refresh = duration(calendar.refreshMinutes);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//stay-ops-planner//calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    "X-WR-TIMEZONE:Europe/Athens",
    `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
    `X-PUBLISHED-TTL:${refresh}`,
    ...calendar.events.flatMap((event) => eventLines(event, calendar.now)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
