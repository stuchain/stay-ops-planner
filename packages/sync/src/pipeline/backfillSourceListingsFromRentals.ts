import { Channel, guessRentalIndexFromTitle, PrismaClient } from "@stay-ops/db";
import type { HosthubClient } from "../hosthub/client.js";
import { mapHosthubListingChannel } from "./mapChannel.js";

function pickRentalId(rental: Record<string, unknown>): string | null {
  const id = rental.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

function pickRentalName(rental: Record<string, unknown>): string | null {
  const n = rental.name;
  return typeof n === "string" && n.trim().length > 0 ? n.trim() : null;
}

function pickChannelLabel(ch: Record<string, unknown>): string | undefined {
  const bc = ch.base_channel;
  if (bc !== null && typeof bc === "object" && !Array.isArray(bc)) {
    const nm = (bc as Record<string, unknown>).name;
    if (typeof nm === "string" && nm.trim().length > 0) {
      return nm.trim();
    }
  }
  const name = ch.name;
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  return undefined;
}

export type BackfillSourceListingsResult = {
  rentalsWalked: number;
  channelRowsSeen: number;
  upsertsTouched: number;
  /** Distinct Hosthub rental ids (same key as calendar `rental.id` / `source_listings.external_listing_id`). */
  rentalIds: string[];
};

/**
 * Ensures `source_listings` has one row per Hosthub **rental × connected channel** (from
 * `GET /rentals` + `GET /rentals/{id}/channels`), matching calendar sync which keys listings by
 * `rental.id` + mapped channel.
 *
 * If Hosthub lists no connection that maps to `direct` (common when only Airbnb + Booking.com are
 * linked), we still upsert `(direct, rental.id)` so the tax ledger always has a direct slot.
 *
 * Without this, listings only appear after a booking syncs on that channel.
 */
export async function backfillSourceListingsFromHosthubRentals(
  prisma: PrismaClient,
  client: HosthubClient,
  opts?: { maxRentalPages?: number; maxChannelPagesPerRental?: number },
): Promise<BackfillSourceListingsResult> {
  const maxRentalPages = opts?.maxRentalPages ?? 100;
  const maxChannelPagesPerRental = opts?.maxChannelPagesPerRental ?? 50;

  let rentalsWalked = 0;
  let channelRowsSeen = 0;
  let upsertsTouched = 0;
  const rentalIds: string[] = [];
  const seenRentalIds = new Set<string>();

  let nextRentalUrl: string | null = null;
  let rentalPagesRead = 0;

  for (;;) {
    if (rentalPagesRead >= maxRentalPages) {
      break;
    }
    const page = await client.listRentalsPage({ nextPageUrl: nextRentalUrl });
    if (!page.ok) {
      throw new Error(`${page.error.code}: ${page.error.message}`);
    }
    rentalPagesRead += 1;

    for (const rental of page.value.data) {
      const rid = pickRentalId(rental);
      if (!rid) {
        continue;
      }
      if (!seenRentalIds.has(rid)) {
        seenRentalIds.add(rid);
        rentalIds.push(rid);
      }
      const rname = pickRentalName(rental);
      rentalsWalked += 1;
      let sawDirectChannel = false;

      let nextChannelUrl: string | null = null;
      let channelPagesRead = 0;
      const seenChannelNextUrls = new Set<string>();
      const seenHosthubChannelIds = new Set<string>();

      for (;;) {
        if (channelPagesRead >= maxChannelPagesPerRental) {
          break;
        }
        const chPage = await client.listRentalChannelsPage({ rentalId: rid, nextPageUrl: nextChannelUrl });
        if (!chPage.ok) {
          throw new Error(`${chPage.error.code}: ${chPage.error.message}`);
        }
        channelPagesRead += 1;

        for (const ch of chPage.value.data) {
          const hid = typeof ch.id === "string" && ch.id.trim().length > 0 ? ch.id.trim() : null;
          if (hid !== null && seenHosthubChannelIds.has(hid)) {
            continue;
          }
          if (hid !== null) {
            seenHosthubChannelIds.add(hid);
          }

          channelRowsSeen += 1;
          const label = pickChannelLabel(ch);
          const channel = mapHosthubListingChannel(label);
          if (channel === Channel.direct) {
            sawDirectChannel = true;
          }

          const row = await prisma.sourceListing.upsert({
            where: {
              channel_externalListingId: {
                channel,
                externalListingId: rid,
              },
            },
            create: {
              channel,
              externalListingId: rid,
              title: rname,
            },
            update: {
              ...(rname !== null ? { title: rname } : {}),
            },
          });

          upsertsTouched += 1;

          if (row.rentalIndex == null) {
            const guessed = guessRentalIndexFromTitle(row.title ?? rname);
            if (guessed != null) {
              await prisma.sourceListing.update({
                where: { id: row.id },
                data: { rentalIndex: guessed },
              });
            }
          }
        }

        const next = chPage.value.nextPageUrl;
        if (!next) {
          break;
        }
        if (seenChannelNextUrls.has(next)) {
          break;
        }
        seenChannelNextUrls.add(next);
        nextChannelUrl = next;
      }

      if (!sawDirectChannel) {
        channelRowsSeen += 1;
        const row = await prisma.sourceListing.upsert({
          where: {
            channel_externalListingId: {
              channel: Channel.direct,
              externalListingId: rid,
            },
          },
          create: {
            channel: Channel.direct,
            externalListingId: rid,
            title: rname,
          },
          update: {
            ...(rname !== null ? { title: rname } : {}),
          },
        });
        upsertsTouched += 1;
        if (row.rentalIndex == null) {
          const guessed = guessRentalIndexFromTitle(row.title ?? rname);
          if (guessed != null) {
            await prisma.sourceListing.update({
              where: { id: row.id },
              data: { rentalIndex: guessed },
            });
          }
        }
      }
    }

    nextRentalUrl = page.value.nextPageUrl;
    if (!nextRentalUrl) {
      break;
    }
  }

  return { rentalsWalked, channelRowsSeen, upsertsTouched, rentalIds };
}
