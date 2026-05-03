import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { listAlertTemplates, listOperationalThresholds, upsertAlertTemplate, upsertOperationalThreshold } from "../../../src/modules/admin-configuration/service";

async function truncate(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_keys",
      "login_attempts",
      "rate_limit_counters",
      "audit_events",
      "alert_template_configs",
      "operational_threshold_configs",
      "assignments",
      "cleaning_tasks",
      "manual_blocks",
      "bookings",
      "source_listings",
      "rooms",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

describe("admin configuration service", () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncate(prisma);
  });

  it("upserts alert templates by event/channel/version", async () => {
    const created = await upsertAlertTemplate({
      eventType: "sync_run_failed",
      channel: "sms",
      templateVersion: 1,
      title: "Sync failed",
      body: "Sync failed for {{source}}",
      enabled: true,
      auditMeta: { requestId: "req_1" },
    });
    expect(created.body).toContain("Sync failed");

    const updated = await upsertAlertTemplate({
      eventType: "sync_run_failed",
      channel: "sms",
      templateVersion: 1,
      title: "Sync failed v2",
      body: "Sync failed for {{source}} {{runId}}",
      enabled: true,
      auditMeta: { requestId: "req_2" },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Sync failed v2");

    const templates = await listAlertTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]?.templateVersion).toBe(1);
  });

  it("upserts threshold values by key", async () => {
    const created = await upsertOperationalThreshold({
      key: "unassigned_backlog_count",
      numericValue: 12,
      unit: "bookings",
      enabled: true,
      notes: "default threshold",
      auditMeta: { requestId: "req_3" },
    });
    expect(created.numericValue).toBe("12");

    const updated = await upsertOperationalThreshold({
      key: "unassigned_backlog_count",
      numericValue: 15,
      unit: "bookings",
      enabled: true,
      notes: "tuned threshold",
      auditMeta: { requestId: "req_4" },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.numericValue).toBe("15");

    const thresholds = await listOperationalThresholds();
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0]?.notes).toBe("tuned threshold");
  });
});
