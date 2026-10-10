import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeHosthubReservationRecord } from "./normalize.js";
import { HosthubReservationDtoSchema } from "./types.dto.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/hosthub");

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, name), "utf-8"));
}

const NON_EVENT_FILES = new Set(["notes-response.json", "gr-taxes-response.json"]);
const eventFiles = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !NON_EVENT_FILES.has(f))
  .sort();

describe("synthetic Hosthub fixtures", () => {
  it("has the expected calendar-event fixtures", () => {
    expect(eventFiles).toEqual([
      "airbnb.json",
      "booking-com.json",
      "cancellation.json",
      "date-change.json",
      "direct.json",
      "hold.json",
      "new-booking.json",
    ]);
  });

  for (const file of eventFiles.filter((f) => f !== "hold.json")) {
    it(`${file} normalises to a valid reservation DTO`, () => {
      const dto = normalizeHosthubReservationRecord(load(file));
      expect(dto).not.toBeNull();
      expect(HosthubReservationDtoSchema.safeParse(dto).success).toBe(true);
      expect(dto?.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dto?.checkOut).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dto?.unknownStatusRaw).toBeUndefined();
    });
  }

  it("hold.json is skipped by the normaliser", () => {
    expect(normalizeHosthubReservationRecord(load("hold.json"))).toBeNull();
  });

  it("new booking, date change and cancellation share one event id", () => {
    const created = normalizeHosthubReservationRecord(load("new-booking.json"));
    const moved = normalizeHosthubReservationRecord(load("date-change.json"));
    const cancelled = normalizeHosthubReservationRecord(load("cancellation.json"));
    expect(created).toMatchObject({
      reservationId: "evt-fake-0001",
      status: "confirmed",
      checkIn: "2030-07-10",
      checkOut: "2030-07-14",
      totalAmountCents: 48000,
    });
    expect(moved).toMatchObject({
      reservationId: "evt-fake-0001",
      status: "confirmed",
      checkIn: "2030-07-12",
      checkOut: "2030-07-17",
    });
    expect(cancelled).toMatchObject({ reservationId: "evt-fake-0001", status: "cancelled" });
  });

  it("covers the Airbnb, Booking.com and direct channels", () => {
    expect(normalizeHosthubReservationRecord(load("airbnb.json"))?.listingChannel).toBe("Airbnb");
    expect(normalizeHosthubReservationRecord(load("booking-com.json"))?.listingChannel).toBe(
      "Booking.com",
    );
    const direct = normalizeHosthubReservationRecord(load("direct.json"));
    expect(direct?.listingChannel).toBe("Direct");
    expect(direct?.status).toBe("confirmed");
  });

  it("notes response has the fields the booking details page reads", () => {
    const body = load("notes-response.json") as { data: Record<string, unknown>[] };
    expect(body.data.length).toBeGreaterThan(0);
    for (const note of body.data) {
      for (const key of ["id", "created", "updated", "status", "content"]) {
        expect(typeof note[key]).toBe("string");
      }
    }
  });

  it("GR-taxes response has numeric fee fields", () => {
    const body = load("gr-taxes-response.json") as { data: Record<string, unknown> };
    for (const key of ["service_fee_host", "service_fee_host_base", "service_fee_host_vat", "extra_taxes"]) {
      expect(typeof body.data[key]).toBe("number");
    }
  });
});
