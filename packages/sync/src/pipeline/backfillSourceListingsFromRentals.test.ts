import { describe, expect, it, vi } from "vitest";
import { Channel, type PrismaClient } from "@stay-ops/db";
import type { HosthubClient } from "../hosthub/client.js";
import { backfillSourceListingsFromHosthubRentals } from "./backfillSourceListingsFromRentals.js";

function mockListingRow(id: string, rentalIndex: number | null = null) {
  return { id, rentalIndex, title: "Cosmos" };
}

describe("backfillSourceListingsFromHosthubRentals", () => {
  it("upserts synthetic direct when API channels are only airbnb and booking", async () => {
    const upsert = vi.fn();
    const update = vi.fn();
    const prisma = {
      sourceListing: { upsert, update },
    } as unknown as PrismaClient;

    upsert.mockImplementation(() => Promise.resolve(mockListingRow("row")));

    const client = {
      listRentalsPage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          data: [{ id: "rent-1", name: "Cosmos" }],
          nextPageUrl: null,
        },
      }),
      listRentalChannelsPage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          data: [
            { name: "Airbnb", base_channel: { name: "Airbnb" } },
            { name: "Booking.com", base_channel: { name: "Booking.com" } },
          ],
          nextPageUrl: null,
        },
      }),
    } as unknown as HosthubClient;

    const out = await backfillSourceListingsFromHosthubRentals(prisma, client);
    expect(out.rentalIds).toEqual(["rent-1"]);

    const directUpserts = upsert.mock.calls.filter(
      (c) => c[0].where.channel_externalListingId.channel === Channel.direct,
    );
    expect(directUpserts.length).toBe(1);
    expect(directUpserts[0][0].where.channel_externalListingId.externalListingId).toBe("rent-1");
    expect(directUpserts[0][0].create).toMatchObject({
      channel: Channel.direct,
      externalListingId: "rent-1",
      title: "Cosmos",
    });
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it("does not add synthetic direct when API already maps a channel to direct", async () => {
    const upsert = vi.fn();
    const update = vi.fn();
    const prisma = {
      sourceListing: { upsert, update },
    } as unknown as PrismaClient;

    upsert.mockImplementation(() => Promise.resolve(mockListingRow("row")));

    const client = {
      listRentalsPage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          data: [{ id: "r1", name: "Villa" }],
          nextPageUrl: null,
        },
      }),
      listRentalChannelsPage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          data: [
            { name: "Airbnb", base_channel: { name: "Airbnb" } },
            { name: "Direct booking", base_channel: { name: "Direct booking" } },
          ],
          nextPageUrl: null,
        },
      }),
    } as unknown as HosthubClient;

    const out = await backfillSourceListingsFromHosthubRentals(prisma, client);
    expect(out.rentalIds).toEqual(["r1"]);

    const directUpserts = upsert.mock.calls.filter(
      (c) => c[0].where.channel_externalListingId.channel === Channel.direct,
    );
    expect(directUpserts.length).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("ignores duplicate channel rows and stops on repeated pagination URLs (Hosthub)", async () => {
    const upsert = vi.fn();
    const update = vi.fn();
    const prisma = {
      sourceListing: { upsert, update },
    } as unknown as PrismaClient;

    upsert.mockImplementation(() => Promise.resolve(mockListingRow("row")));

    const airbnb = { id: "ch-air", name: "Airbnb X", base_channel: { name: "Airbnb" } };
    const booking = { id: "ch-bk", name: "Booking.com X", base_channel: { name: "Booking.com" } };
    const nextDup = "https://app.hosthub.com/api/2019-03-01/rentals/r1/channels?cursor_gt=dup";

    const listRentalChannelsPage = vi.fn();
    listRentalChannelsPage
      .mockResolvedValueOnce({
        ok: true,
        value: { data: [airbnb, booking], nextPageUrl: nextDup },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { data: [airbnb, booking], nextPageUrl: nextDup },
      });

    const client = {
      listRentalsPage: vi.fn().mockResolvedValue({
        ok: true,
        value: { data: [{ id: "r1", name: "Villa" }], nextPageUrl: null },
      }),
      listRentalChannelsPage,
    } as unknown as HosthubClient;

    const out = await backfillSourceListingsFromHosthubRentals(prisma, client);
    expect(out.rentalIds).toEqual(["r1"]);

    expect(listRentalChannelsPage).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(3);
  });
});
