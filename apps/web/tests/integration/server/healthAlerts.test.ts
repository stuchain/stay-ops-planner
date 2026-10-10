/**
 * P2-8: sync health alerts against a real database, and auth of the cron route.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@stay-ops/db";
import type { Notifier } from "@/server/monitoring/notifier";
import { runHealthAlerts } from "@/server/monitoring/runHealthAlerts";

const prisma = new PrismaClient();
const noon = new Date("2026-07-15T09:00:00Z"); // 12:00 in Athens
const hoursAgo = (h: number) => new Date(noon.getTime() - h * 3_600_000);

function fakeNotifier(ok = true) {
  const send = vi.fn().mockResolvedValue(ok);
  const notifier: Notifier = { name: "fake", send };
  return { notifier, send };
}

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "alert_states", "sync_state", "import_errors", "sync_runs" RESTART IDENTITY CASCADE`,
  );
}

async function addRun(status: "completed" | "failed", minsAgo: number) {
  await prisma.syncRun.create({
    data: { status, source: "hosthub_poll", startedAt: new Date(noon.getTime() - minsAgo * 60_000) },
  });
}

beforeEach(reset);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("runHealthAlerts", () => {
  it("stays quiet when the sync is healthy", async () => {
    await prisma.syncState.create({ data: { id: 1, lastSuccessAt: hoursAgo(1) } });
    await addRun("completed", 60);
    const { notifier, send } = fakeNotifier();
    const r = await runHealthAlerts({ db: prisma, notifiers: [notifier], now: noon });
    expect(r.problems).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("alerts once for a stale sync, not again while it stays stale", async () => {
    await prisma.syncState.create({ data: { id: 1, lastSuccessAt: hoursAgo(5), lastError: "Hosthub 503" } });
    await addRun("completed", 300);
    const { notifier, send } = fakeNotifier();

    const first = await runHealthAlerts({ db: prisma, notifiers: [notifier], now: noon });
    expect(first.alerted).toEqual(["sync_stale"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].body).toContain("Hosthub 503");

    const later = new Date(noon.getTime() + 30 * 60_000);
    const second = await runHealthAlerts({ db: prisma, notifiers: [notifier], now: later });
    expect(second.problems).toEqual(["sync_stale"]);
    expect(second.alerted).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("alerts on two failed runs in a row, sends an all-clear on recovery, and can alert again later", async () => {
    await prisma.syncState.create({ data: { id: 1, lastSuccessAt: hoursAgo(1) } });
    await addRun("failed", 90);
    await addRun("failed", 30);
    const { notifier, send } = fakeNotifier();

    expect((await runHealthAlerts({ db: prisma, notifiers: [notifier], now: noon })).alerted).toEqual(["sync_failing"]);

    await addRun("completed", 5);
    const ok = await runHealthAlerts({ db: prisma, notifiers: [notifier], now: noon });
    expect(ok.recovered).toEqual(["sync_failing"]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.alertState.count()).toBe(0);

    await addRun("failed", -1);
    await addRun("failed", -2);
    expect((await runHealthAlerts({ db: prisma, notifiers: [notifier], now: noon })).alerted).toEqual(["sync_failing"]);
  });

  it("retries on the next run when delivery failed or nothing is configured", async () => {
    await prisma.syncState.create({ data: { id: 1, lastSuccessAt: hoursAgo(6) } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const none = await runHealthAlerts({ db: prisma, notifiers: [], now: noon });
    expect(none.delivery).toBe("unconfigured");
    expect(await prisma.alertState.count()).toBe(0);

    const bad = fakeNotifier(false);
    expect((await runHealthAlerts({ db: prisma, notifiers: [bad.notifier], now: noon })).delivery).toBe("failed");
    expect(await prisma.alertState.count()).toBe(0);

    const good = fakeNotifier();
    expect((await runHealthAlerts({ db: prisma, notifiers: [good.notifier], now: noon })).alerted).toEqual([
      "sync_stale",
    ]);
  });
});

describe("GET /api/cron/health-alerts auth", () => {
  const secret = "health-alerts-secret-0123456789";
  const url = "http://localhost/api/cron/health-alerts";

  async function call(headers: Record<string, string>) {
    const { GET } = await import("../../../src/app/api/cron/health-alerts/route");
    return GET(new NextRequest(url, { headers }));
  }

  it("rejects missing or wrong credentials, and everything when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong-secret-0123456789" })).status).toBe(401);
    expect((await call({ authorization: secret })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ authorization: `Bearer ${secret}` })).status).toBe(401);
  });

  it("runs the check with the right bearer token", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call({ authorization: `Bearer ${secret}` });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { problems: string[] } };
    expect(Array.isArray(json.data.problems)).toBe(true);
  });
});
