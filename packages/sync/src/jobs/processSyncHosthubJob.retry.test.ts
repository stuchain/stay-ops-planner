import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { processSyncHosthubJob } from "./processSyncHosthubJob.js";
import { JOB_HOSTHUB_INBOUND } from "../queue/constants.js";
import * as db from "../db/client.js";
import * as extract from "../pipeline/extractReservation.js";
import * as apply from "../pipeline/applyHosthubReservation.js";
import * as syncRun from "../pipeline/syncRunService.js";

describe("processSyncHosthubJob error classification", () => {
  const prevToken = process.env.HOSTHUB_API_TOKEN;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.HOSTHUB_API_TOKEN;
    vi.spyOn(db, "getSyncPrisma").mockReturnValue({} as ReturnType<typeof db.getSyncPrisma>);
    vi.spyOn(syncRun, "recordImportError").mockResolvedValue(undefined);
    vi.spyOn(syncRun, "finalizeSyncRun").mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.HOSTHUB_API_TOKEN;
    else process.env.HOSTHUB_API_TOKEN = prevToken;
  });

  function inboundJob(rawBody: string): Job {
    return {
      name: JOB_HOSTHUB_INBOUND,
      data: { dedupeKey: "dk1", rawBody },
    } as Job;
  }

  it("rethrows transient errors without recording sync run (BullMQ can retry)", async () => {
    const startSpy = vi.spyOn(syncRun, "startSyncRun");
    const dto = {
      reservationId: "r1",
      listingId: "l1",
      status: "confirmed" as const,
      checkIn: "2026-01-01",
      checkOut: "2026-01-02",
      listingChannel: "airbnb",
    };
    vi.spyOn(extract, "extractHosthubReservationDto").mockReturnValue(dto);
    vi.spyOn(apply, "applyHosthubReservation").mockRejectedValue(new Error("database connection failed"));

    const rawBody = JSON.stringify({ type: "calendar_event", id: "evt1", ...dto });
    await expect(processSyncHosthubJob(inboundJob(rawBody))).rejects.toThrow("database connection failed");
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("records and throws UnrecoverableError for payload extraction failure", async () => {
    const startSpy = vi.spyOn(syncRun, "startSyncRun").mockResolvedValue({ id: "run-1" } as never);
    vi.spyOn(extract, "extractHosthubReservationDto").mockReturnValue(null);

    const rawBody = JSON.stringify({ type: "calendar_event", id: "evt2" });
    await expect(processSyncHosthubJob(inboundJob(rawBody))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(startSpy).toHaveBeenCalled();
    expect(syncRun.recordImportError).toHaveBeenCalled();
    expect(syncRun.finalizeSyncRun).toHaveBeenCalled();
  });
});
