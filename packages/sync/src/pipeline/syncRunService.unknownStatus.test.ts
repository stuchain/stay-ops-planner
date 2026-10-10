import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@stay-ops/db";
import { recordUnknownStatus } from "./syncRunService.js";

function fakePrisma() {
  const create = vi.fn().mockResolvedValue({});
  return { prisma: { importError: { create } } as unknown as PrismaClient, create };
}

describe("recordUnknownStatus", () => {
  it("writes an UNKNOWN_STATUS import error for a flagged row", async () => {
    const { prisma, create } = fakePrisma();
    await recordUnknownStatus(prisma, "run-1", { reservationId: "r1", unknownStatusRaw: "weird" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      syncRunId: "run-1",
      code: "UNKNOWN_STATUS",
      payload: { reservationId: "r1", status: "weird" },
    });
  });

  it("writes nothing for a row with a known status", async () => {
    const { prisma, create } = fakePrisma();
    await recordUnknownStatus(prisma, "run-1", { reservationId: "r1" });
    expect(create).not.toHaveBeenCalled();
  });
});
