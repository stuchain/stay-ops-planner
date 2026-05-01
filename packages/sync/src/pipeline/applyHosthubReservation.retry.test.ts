import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Prisma, PrismaClient } from "@stay-ops/db";
import * as shared from "@stay-ops/shared";
import { applyHosthubReservation } from "./applyHosthubReservation.js";
import type { HosthubReservationDto } from "../hosthub/types.dto.js";

describe("applyHosthubReservation + withRetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps prisma.$transaction in withRetry with Prisma transient predicate", async () => {
    const withRetrySpy = vi.spyOn(shared, "withRetry").mockImplementation(async (op) => {
      return op({ attempt: 1 });
    });
    const $transaction = vi.fn().mockImplementation(async (fn: (tx: Record<string, never>) => Promise<void>) => {
      return fn({});
    });
    const prisma = { $transaction } as unknown as PrismaClient;

    const dto: HosthubReservationDto = {
      reservationId: "r-retry-test",
      listingId: "l-retry-test",
      status: "confirmed",
      checkIn: "2026-01-01",
      checkOut: "2026-01-02",
      listingChannel: "airbnb",
    };
    const raw = { type: "calendar_event", ...dto } as unknown as Prisma.InputJsonValue;

    await expect(applyHosthubReservation(prisma, dto, raw)).rejects.toThrow();
    expect(withRetrySpy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxAttempts: 3,
        isTransient: expect.any(Function),
      }),
    );
    expect($transaction).toHaveBeenCalled();
  });
});
