import { createTranslator } from "next-intl";
import { z } from "zod";
import { writeAuditSnapshot } from "@stay-ops/audit";
import { log } from "@stay-ops/shared";
import el from "../../../messages/el.json";
import { prisma } from "@/lib/prisma";
import { deliver, notifiersFromEnv, type Alert, type Notifier } from "@/server/monitoring/notifier";
import { todayIso } from "@/server/time";
import { readSetting, writeSetting } from "@/server/useCases/settings";
import { getTodaySummary, type TodayStay, type TodaySummary } from "@/server/useCases/todaySummary";

export const REMINDER_SETTING_KEY = "dailyReminder";

const reminderSettingSchema = z.object({
  enabled: z.boolean().default(true),
  /** The day (Athens) the last daily message went out, so a retried run does not send it twice. */
  lastSentOn: z.string().nullable().default(null),
});
export type ReminderSetting = z.infer<typeof reminderSettingSchema>;

export async function loadReminderSetting(): Promise<ReminderSetting> {
  const parsed = reminderSettingSchema.safeParse((await readSetting(REMINDER_SETTING_KEY)) ?? {});
  return parsed.success ? parsed.data : { enabled: true, lastSentOn: null };
}

/**
 * Where reminders go: REMINDER_EMAIL_TO / REMINDER_TELEGRAM_CHAT_ID when set (for example the father's
 * address), otherwise the same place as the health alerts.
 */
export function reminderNotifiersFromEnv(env: Record<string, string | undefined> = process.env): Notifier[] {
  return notifiersFromEnv({
    ...env,
    ALERT_EMAIL_TO: env.REMINDER_EMAIL_TO?.trim() || env.ALERT_EMAIL_TO,
    TELEGRAM_CHAT_ID: env.REMINDER_TELEGRAM_CHAT_ID?.trim() || env.TELEGRAM_CHAT_ID,
  });
}

const t = createTranslator({ locale: "el", messages: el, namespace: "reminders" });

function stayLine(stay: TodayStay): string {
  const name = stay.guestName ?? t("noName");
  const room = stay.room?.name ?? t("noRoom");
  const people = stay.partySize === null ? "" : t("people", { count: stay.partySize });
  return `• ${room}: ${name}${people ? ` (${people})` : ""}`;
}

/** The morning message in Greek, or null when there is nothing to say. */
export function buildDailyReminder(summary: TodaySummary): Alert | null {
  const { arrivals, departures, tomorrowArrivals, needsApartment } = summary;
  if (arrivals.length + departures.length + tomorrowArrivals.length + needsApartment === 0) return null;

  const headline: string[] = [];
  if (needsApartment > 0) headline.push(t("needsApartment", { count: needsApartment }));
  if (arrivals.length > 0) headline.push(t("arrivalsToday", { count: arrivals.length }));
  if (tomorrowArrivals.length > 0) headline.push(t("arrivalsTomorrow", { count: tomorrowArrivals.length }));
  if (headline.length === 0) headline.push(t("departuresToday", { count: departures.length }));

  const sections: string[] = [];
  if (needsApartment > 0) sections.push(t("needsApartmentLine", { count: needsApartment }));
  const list = (title: string, stays: TodayStay[]) => {
    if (stays.length > 0) sections.push([title, ...stays.map(stayLine)].join("\n"));
  };
  list(t("departuresTitle", { count: departures.length }), departures);
  list(t("arrivalsTitle", { count: arrivals.length }), arrivals);
  list(t("tomorrowTitle", { count: tomorrowArrivals.length }), tomorrowArrivals);

  return {
    subject: t("subject", { summary: headline.join(" · ") }),
    body: `${sections.join("\n\n")}\n\n${t("footer")}`,
  };
}

export type DailyReminderResult = {
  status: "sent" | "failed" | "unconfigured" | "nothing" | "disabled" | "already_sent";
};

/**
 * The daily reminder (P4-3), called each morning by .github/workflows/daily-reminders.yml. Sends once per
 * day at most; a failed or unconfigured delivery is not recorded, so a later run tries again. `test` sends
 * now even when switched off or already sent, and does not count as the day's message.
 */
export async function runDailyReminder(opts: {
  notifiers: Notifier[];
  now?: Date;
  test?: boolean;
}): Promise<DailyReminderResult> {
  const now = opts.now ?? new Date();
  const today = todayIso(now);
  const setting = await loadReminderSetting();
  if (!opts.test && !setting.enabled) return { status: "disabled" };
  if (!opts.test && setting.lastSentOn === today) return { status: "already_sent" };

  const summary = await getTodaySummary(now);
  const message = buildDailyReminder(summary);
  if (message === null) {
    if (!opts.test) return { status: "nothing" };
  }
  const alert = message ?? { subject: t("testSubject"), body: t("testBody") };
  const delivery = await deliver(opts.notifiers, alert);
  log("info", "daily_reminder", { delivery, test: Boolean(opts.test), today });
  if (delivery === "sent" && !opts.test) await writeSetting(REMINDER_SETTING_KEY, { ...setting, lastSentOn: today });
  return { status: delivery };
}

/** Dev mode > System: switch the daily message on or off. */
export async function setReminderEnabled(enabled: boolean, actorUserId: string): Promise<ReminderSetting> {
  const before = await loadReminderSetting();
  const after = { ...before, enabled };
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: REMINDER_SETTING_KEY },
      create: { key: REMINDER_SETTING_KEY, value: after },
      update: { value: after },
    });
    await writeAuditSnapshot(tx, {
      actorUserId,
      entityType: "setting",
      entityId: REMINDER_SETTING_KEY,
      action: "setting.update",
      before,
      after,
    });
  });
  return after;
}
