import { log } from "@stay-ops/shared";

export type Alert = { subject: string; body: string };

/** A way to reach Stelios. `send` resolves true when the message was handed to the provider. */
export type Notifier = {
  name: string;
  send(alert: Alert): Promise<boolean>;
};

type Fetch = typeof fetch;

export function resendNotifier(
  opts: { apiKey: string; to: string; from?: string },
  fetchImpl: Fetch = fetch,
): Notifier {
  return {
    name: "resend",
    async send(alert) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: opts.from ?? "Stay Ops <onboarding@resend.dev>",
          to: opts.to
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          subject: alert.subject,
          text: alert.body,
        }),
      });
      if (!res.ok) log("error", "alert_resend_failed", { status: res.status });
      return res.ok;
    },
  };
}

export function telegramNotifier(opts: { botToken: string; chatId: string }, fetchImpl: Fetch = fetch): Notifier {
  return {
    name: "telegram",
    async send(alert) {
      const res = await fetchImpl(`https://api.telegram.org/bot${opts.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: opts.chatId, text: `${alert.subject}\n\n${alert.body}` }),
      });
      if (!res.ok) log("error", "alert_telegram_failed", { status: res.status });
      return res.ok;
    },
  };
}

/** Notifiers for whatever is configured in the environment. Empty when nothing is. */
export function notifiersFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): Notifier[] {
  const list: Notifier[] = [];
  const resendKey = env.RESEND_API_KEY?.trim();
  const to = env.ALERT_EMAIL_TO?.trim();
  if (resendKey && to) {
    const from = env.ALERT_EMAIL_FROM?.trim();
    list.push(resendNotifier({ apiKey: resendKey, to, ...(from ? { from } : {}) }, fetchImpl));
  }
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (botToken && chatId) list.push(telegramNotifier({ botToken, chatId }, fetchImpl));
  return list;
}

/**
 * Sends to every notifier. Returns "sent" if at least one succeeded, "failed" if all failed,
 * "unconfigured" (and logs) when there is none.
 */
export async function deliver(notifiers: Notifier[], alert: Alert): Promise<"sent" | "failed" | "unconfigured"> {
  if (notifiers.length === 0) {
    // Only the subject: bodies can hold guest names, and Vercel logs are kept outside the app.
    log("warn", "alert_not_delivered_no_notifier", { subject: alert.subject });
    return "unconfigured";
  }
  let sent = false;
  for (const n of notifiers) {
    try {
      if (await n.send(alert)) sent = true;
    } catch (e) {
      log("error", "alert_notifier_threw", { notifier: n.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return sent ? "sent" : "failed";
}
