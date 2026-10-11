import { writeAuditSnapshot } from "@stay-ops/audit";
import { DomainError } from "@stay-ops/domain";
import { prisma } from "@/lib/prisma";
import { deliver, notifiersFromEnv, type Notifier } from "@/server/monitoring/notifier";

/** At most this many help messages per person per hour, so a stuck button cannot flood the inbox. */
export const HELP_PER_HOUR = 5;

export type HelpRequestInput = {
  actorUserId: string;
  /** What the person wrote, if anything. */
  message: string;
  /** The page they were on, for example `/app/calendar?booking=abc`. */
  page: string;
  /** The last error sentence they saw and when, if any. */
  lastError: { text: string; at: string } | null;
  sentryEventId: string | null;
  userAgent: string;
  viewport: string;
  textSize: string | null;
};

/** "Στείλε στον Στέλιο" (P4-11): e-mails Stelios what the person is looking at and the last error. */
export async function sendHelpRequest(
  input: HelpRequestInput,
  opts: { notifiers?: Notifier[]; now?: Date } = {},
): Promise<{ status: "sent" | "failed" | "unconfigured" }> {
  const now = opts.now ?? new Date();
  const user = await prisma.user.findUnique({ where: { id: input.actorUserId }, select: { id: true, email: true } });
  if (!user) throw new DomainError("UNAUTHORIZED");
  const recent = await prisma.auditEvent.count({
    where: { userId: user.id, action: "help.request", createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
  });
  if (recent >= HELP_PER_HOUR) throw new DomainError("TOO_MANY_REQUESTS");

  const lines = [
    `From: ${user.email}`,
    `Page: ${input.page}`,
    `When: ${now.toISOString()}`,
    "",
    input.message.trim() ? `Message:\n${input.message.trim()}` : "Message: (none)",
    "",
    input.lastError ? `Last error (${input.lastError.at}): ${input.lastError.text}` : "Last error: none seen",
    `Sentry event: ${input.sentryEventId ?? "none"}`,
    `Browser: ${input.userAgent}`,
    `Screen: ${input.viewport}${input.textSize ? `, text size ${input.textSize}` : ""}`,
  ];
  const status = await deliver(opts.notifiers ?? notifiersFromEnv(), {
    subject: `Stay Ops: help request from ${user.email}`,
    body: lines.join("\n"),
  });
  if (status === "sent") {
    await writeAuditSnapshot(prisma, {
      actorUserId: user.id,
      action: "help.request",
      entityType: "user",
      entityId: user.id,
      before: null,
      after: { page: input.page, sentryEventId: input.sentryEventId },
    });
  }
  return { status };
}
