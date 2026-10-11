/**
 * P4-11: "Στείλε στον Στέλιο" against a real database.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { DomainError } from "@stay-ops/domain";
import type { Notifier } from "@/server/monitoring/notifier";
import { HELP_PER_HOUR, sendHelpRequest, type HelpRequestInput } from "@/server/useCases/helpRequest";

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");

function fakeNotifier(ok = true) {
  const send = vi.fn().mockResolvedValue(ok);
  const notifier: Notifier = { name: "fake", send };
  return { notifier, send };
}

let actorUserId: string;
const input = (over: Partial<HelpRequestInput> = {}): HelpRequestInput => ({
  actorUserId,
  message: "  Δεν μπορώ να μετακινήσω την κράτηση  ",
  page: "/app/calendar?booking=b1",
  lastError: { text: "Η κράτηση άλλαξε στο μεταξύ.", at: "2030-06-10T08:59:00.000Z" },
  sentryEventId: "abc123",
  userAgent: "Mozilla/5.0 Edge",
  viewport: "1366x768 @1.25x",
  textSize: "large",
  ...over,
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "audit_events", "users" RESTART IDENTITY CASCADE`);
  actorUserId = (await prisma.user.create({ data: { email: "papa@example.com", passwordHash: "x" } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendHelpRequest", () => {
  it("mails the page, message, last error, Sentry id and screen, and records it", async () => {
    const { notifier, send } = fakeNotifier();
    expect(await sendHelpRequest(input(), { notifiers: [notifier], now: NOW })).toEqual({ status: "sent" });
    const alert = send.mock.calls[0]![0] as { subject: string; body: string };
    expect(alert.subject).toBe("Stay Ops: help request from papa@example.com");
    expect(alert.body).toContain("Page: /app/calendar?booking=b1");
    expect(alert.body).toContain("Message:\nΔεν μπορώ να μετακινήσω την κράτηση");
    expect(alert.body).toContain("Last error (2030-06-10T08:59:00.000Z): Η κράτηση άλλαξε στο μεταξύ.");
    expect(alert.body).toContain("Sentry event: abc123");
    expect(alert.body).toContain("Screen: 1366x768 @1.25x, text size large");
    expect(await prisma.auditEvent.count({ where: { action: "help.request" } })).toBe(1);
  });

  it("says when nothing is set up to send it, and records nothing", async () => {
    const result = await sendHelpRequest(input({ message: "", lastError: null, sentryEventId: null, textSize: null }), {
      notifiers: [],
      now: NOW,
    });
    expect(result).toEqual({ status: "unconfigured" });
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it(`allows ${HELP_PER_HOUR} messages an hour per person`, async () => {
    const { notifier } = fakeNotifier();
    // Real time: the audit rows are stamped by the database.
    for (let i = 0; i < HELP_PER_HOUR; i++) await sendHelpRequest(input(), { notifiers: [notifier] });
    await expect(sendHelpRequest(input(), { notifiers: [notifier] })).rejects.toEqual(
      new DomainError("TOO_MANY_REQUESTS"),
    );
  });
});
