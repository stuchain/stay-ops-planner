import { afterEach, describe, expect, it, vi } from "vitest";
import { deliver, notifiersFromEnv } from "../../../src/server/monitoring/notifier";

afterEach(() => vi.restoreAllMocks());

describe("notifiersFromEnv", () => {
  it("is empty when nothing is configured, or only half of a pair is", () => {
    expect(notifiersFromEnv({})).toEqual([]);
    expect(notifiersFromEnv({ RESEND_API_KEY: "k" })).toEqual([]);
    expect(notifiersFromEnv({ TELEGRAM_BOT_TOKEN: "t" })).toEqual([]);
  });
  it("creates one notifier per configured channel", () => {
    const env = { RESEND_API_KEY: "k", ALERT_EMAIL_TO: "a@b.c", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" };
    expect(notifiersFromEnv(env).map((n) => n.name)).toEqual(["resend", "telegram"]);
  });
  it("posts to Resend and Telegram with the right payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const env = {
      RESEND_API_KEY: "key",
      ALERT_EMAIL_TO: "a@b.c, d@e.f",
      TELEGRAM_BOT_TOKEN: "tok",
      TELEGRAM_CHAT_ID: "42",
    };
    const result = await deliver(notifiersFromEnv(env, fetchMock as unknown as typeof fetch), {
      subject: "S",
      body: "B",
    });
    expect(result).toBe("sent");
    const [resendUrl, resendInit] = fetchMock.mock.calls[0]!;
    expect(resendUrl).toBe("https://api.resend.com/emails");
    expect(resendInit.headers.Authorization).toBe("Bearer key");
    expect(JSON.parse(resendInit.body)).toMatchObject({ to: ["a@b.c", "d@e.f"], subject: "S", text: "B" });
    const [tgUrl, tgInit] = fetchMock.mock.calls[1]!;
    expect(tgUrl).toBe("https://api.telegram.org/bottok/sendMessage");
    expect(JSON.parse(tgInit.body)).toMatchObject({ chat_id: "42" });
  });
});

describe("deliver", () => {
  it("logs and reports unconfigured when there is no notifier", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await deliver([], { subject: "S", body: "B" })).toBe("unconfigured");
    expect(warn).toHaveBeenCalledOnce();
  });
  it("is sent when one channel works and another throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { name: "bad", send: vi.fn().mockRejectedValue(new Error("boom")) };
    const good = { name: "good", send: vi.fn().mockResolvedValue(true) };
    expect(await deliver([bad, good], { subject: "S", body: "B" })).toBe("sent");
  });
  it("is failed when every channel fails", async () => {
    const no = { name: "no", send: vi.fn().mockResolvedValue(false) };
    expect(await deliver([no], { subject: "S", body: "B" })).toBe("failed");
  });
});
