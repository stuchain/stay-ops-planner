/**
 * P4-10: guest message templates in the settings table, with audit rows and fall back to the built-in texts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@stay-ops/db";
import { DEFAULT_TEMPLATES } from "@/i18n/guestMessages/defaults";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const prisma = new PrismaClient();
const NOW = new Date("2030-06-10T09:00:00Z");
let userId: string;

async function truncate() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "audit_events", "assignments", "cleaning_tasks", "manual_blocks", "bookings", "rooms",
      "source_listings", "settings", "users" RESTART IDENTITY CASCADE;
  `);
}

async function caller(role: "admin" | "operator" | "viewer" = "admin") {
  const { appRouter } = await import("@/server/api/root");
  return appRouter.createCaller({ headers: new Headers(), user: { userId, role, sessionExpiresAt: NOW } });
}

describe("guest message templates", () => {
  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await truncate();
    userId = (await prisma.user.create({ data: { email: `admin-${Date.now()}@example.com`, passwordHash: "x" } })).id;
  });

  it("starts with the built-in texts and stores nothing", async () => {
    const admin = await caller();
    const data = await admin.dev.messageTemplates();
    expect(data.overrides).toEqual([]);
    expect(data.defaults).toEqual(DEFAULT_TEMPLATES);
    expect(await prisma.setting.count()).toBe(0);
  });

  it("saves a text for all apartments and one for a single apartment, and audits each save", async () => {
    const admin = await caller();
    const room = await prisma.room.create({
      data: { code: "rental-onar", displayName: "Onar", maxGuests: 4, isActive: true, calendarSortIndex: 1 },
    });
    await admin.dev.saveMessageTemplate({ kind: "wifi", lang: "en", roomId: null, text: " Network: Home " });
    const after = await admin.dev.saveMessageTemplate({
      kind: "wifi",
      lang: "en",
      roomId: room.id,
      text: "Onar Wi-Fi",
    });
    expect(after.overrides).toEqual([
      { kind: "wifi", lang: "en", roomId: null, text: "Network: Home" },
      { kind: "wifi", lang: "en", roomId: room.id, text: "Onar Wi-Fi" },
    ]);
    expect(
      await prisma.auditEvent.count({ where: { action: "setting.update", entityId: "guestMessageTemplates" } }),
    ).toBe(2);

    // Saving the same slot again replaces it.
    const replaced = await admin.dev.saveMessageTemplate({ kind: "wifi", lang: "en", roomId: room.id, text: "New" });
    expect(replaced.overrides).toHaveLength(2);
    expect(replaced.overrides.find((o) => o.roomId === room.id)?.text).toBe("New");
  });

  it("lets any signed-in user read the texts, but only an admin change them", async () => {
    const admin = await caller();
    await admin.dev.saveMessageTemplate({ kind: "welcome", lang: "el", roomId: null, text: "Γεια!" });
    for (const role of ["viewer", "operator"] as const) {
      const user = await caller(role);
      expect((await user.booking.messageTemplates()).overrides).toHaveLength(1);
      await expect(
        user.dev.saveMessageTemplate({ kind: "welcome", lang: "el", roomId: null, text: "x" }),
      ).rejects.toBeTruthy();
      await expect(user.dev.messageTemplates()).rejects.toBeTruthy();
    }
  });

  it("reset removes one override, audits it, and removes the setting when none is left", async () => {
    const admin = await caller();
    await admin.dev.saveMessageTemplate({ kind: "wifi", lang: "en", roomId: null, text: "A" });
    await admin.dev.saveMessageTemplate({ kind: "wifi", lang: "el", roomId: null, text: "B" });
    const one = await admin.dev.resetMessageTemplate({ kind: "wifi", lang: "en", roomId: null });
    expect(one.overrides.map((o) => o.lang)).toEqual(["el"]);
    const none = await admin.dev.resetMessageTemplate({ kind: "wifi", lang: "el", roomId: null });
    expect(none.overrides).toEqual([]);
    expect(await prisma.setting.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "setting.reset" } })).toBe(2);

    // Resetting what is not saved changes and audits nothing.
    await admin.dev.resetMessageTemplate({ kind: "welcome", lang: "en", roomId: null });
    expect(await prisma.auditEvent.count({ where: { action: "setting.reset" } })).toBe(2);
  });

  it("refuses empty or huge texts, unknown kinds and unknown apartments", async () => {
    const admin = await caller();
    const slot = { kind: "wifi", lang: "en", roomId: null } as const;
    await expect(admin.dev.saveMessageTemplate({ ...slot, text: "   " })).rejects.toBeTruthy();
    await expect(admin.dev.saveMessageTemplate({ ...slot, text: "x".repeat(4001) })).rejects.toBeTruthy();
    await expect(admin.dev.saveMessageTemplate({ ...slot, kind: "spam" as never, text: "x" })).rejects.toBeTruthy();
    await expect(admin.dev.saveMessageTemplate({ ...slot, roomId: "no-such-room", text: "x" })).rejects.toBeTruthy();
    expect(await prisma.setting.count()).toBe(0);
  });

  it("falls back to the built-in texts when the stored value is not valid", async () => {
    await prisma.setting.create({
      data: {
        key: "guestMessageTemplates",
        value: { templates: [{ kind: "wifi", lang: "fr", roomId: null, text: "x" }] },
      },
    });
    const admin = await caller();
    expect((await admin.dev.messageTemplates()).overrides).toEqual([]);
    await prisma.setting.update({ where: { key: "guestMessageTemplates" }, data: { value: "garbage" } });
    expect((await admin.booking.messageTemplates()).overrides).toEqual([]);
    // The same slot twice is also not valid.
    const twice = { kind: "wifi", lang: "en", roomId: null, text: "x" };
    await prisma.setting.update({
      where: { key: "guestMessageTemplates" },
      data: { value: { templates: [twice, twice] } },
    });
    expect((await admin.booking.messageTemplates()).overrides).toEqual([]);
  });

  it("booking.details includes the guest's phone and e-mail", async () => {
    const booking = await prisma.booking.create({
      data: {
        channel: "direct",
        externalBookingId: "msg-1",
        status: "confirmed",
        checkinDate: new Date("2030-06-20T00:00:00Z"),
        checkoutDate: new Date("2030-06-23T00:00:00Z"),
        nights: 3,
        guestName: "Anna Smith",
        guestPhone: " +30 691 234 5678 ",
        guestEmail: null,
      },
    });
    const admin = await caller();
    const details = await admin.booking.details({ bookingId: booking.id });
    expect(details.phone).toBe("+30 691 234 5678");
    expect(details.email).toBeNull();
  });
});
