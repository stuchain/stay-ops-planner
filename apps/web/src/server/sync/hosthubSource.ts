import type { PrismaClient } from "@stay-ops/db";
import { backfillSourceListingsFromHosthubRentals, HosthubClient } from "@stay-ops/sync";

/** The Hosthub calls sync makes. Tests pass recorded pages instead of the HTTP client. */
export type HosthubSource = Pick<
  HosthubClient,
  "listCalendarEventsPage" | "listRentalCalendarEventsPage" | "getCalendarEventNotes" | "getCalendarEventGrTaxes"
> & {
  /** Walks `GET /rentals` and their channels into `source_listings`; returns the rental ids. */
  backfillListings?: (db: PrismaClient) => Promise<{ rentalIds: string[]; upserts: number }>;
};

const DEFAULT_BASE_URL = "https://app.hosthub.com/api/2019-03-01";

export function hosthubSource(apiToken: string): HosthubSource {
  const listPath = process.env.HOSTHUB_API_RESERVATIONS_PATH?.trim();
  const client = new HosthubClient({
    baseUrl: process.env.HOSTHUB_API_BASE?.trim() || DEFAULT_BASE_URL,
    apiToken,
    ...(listPath ? { listReservationsPath: listPath } : {}),
  });
  return {
    listCalendarEventsPage: (args) => client.listCalendarEventsPage(args),
    listRentalCalendarEventsPage: (args) => client.listRentalCalendarEventsPage(args),
    getCalendarEventNotes: (id) => client.getCalendarEventNotes(id),
    getCalendarEventGrTaxes: (id) => client.getCalendarEventGrTaxes(id),
    backfillListings: async (db) => {
      const r = await backfillSourceListingsFromHosthubRentals(db, client);
      return { rentalIds: r.rentalIds, upserts: r.upsertsTouched };
    },
  };
}
