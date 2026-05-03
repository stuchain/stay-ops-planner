import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BookingStatus } from "@stay-ops/db";
import { HosthubClient, mapHosthubListingChannel } from "@stay-ops/sync";
import { apiError, respondAuthError } from "@/lib/apiError";
import { DEFAULT_USER_RATE_RULES, withRateLimit } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { AuthError } from "@/modules/auth/errors";
import { requireAdminSession, requireOperatorOrAdmin } from "@/modules/auth/guard";
import { bookingOverlapsUtcCalendarYearWhere } from "@/app/api/excel/listings/bookingOverlapYearWhere";
import { getHosthubTokenStatus, resolveHosthubApiToken } from "@/modules/integrations/hosthubToken";

type DistinctListing = { channel: string; listingId: string; title: string | null };

function distinctListingsFromPage(rows: Array<{ listingId: string; listingChannel?: string; listingName?: string }>): DistinctListing[] {
  const seen = new Set<string>();
  const out: DistinctListing[] = [];
  for (const row of rows) {
    const channel = mapHosthubListingChannel(row.listingChannel);
    const key = `${channel}:${row.listingId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      channel: String(channel),
      listingId: row.listingId,
      title: row.listingName?.trim() ? row.listingName.trim() : null,
    });
  }
  return out;
}

function parseOverlapYearParam(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const y = Number.parseInt(raw, 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
  return y;
}

async function getHosthubDiag(request: NextRequest): Promise<Response> {
  const probeHosthub = request.nextUrl.searchParams.get("probeHosthub") === "true";
  const overlapYear = parseOverlapYearParam(request.nextUrl.searchParams.get("overlapYear"));

  try {
    if (probeHosthub) {
      await requireAdminSession(request);
    } else {
      await requireOperatorOrAdmin(request);
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return respondAuthError(request, err);
    }
    throw err;
  }

  try {
    const [
      total,
      byChannel,
      sample,
      syncRuns,
      importErrors,
      tokenStatus,
      bookingTotals,
      bookingsByStatus,
      bookingsWithoutListing,
      bookingsByChannel,
    ] = await Promise.all([
      prisma.sourceListing.count(),
      prisma.sourceListing.groupBy({
        by: ["channel"],
        _count: { _all: true },
        orderBy: { channel: "asc" },
      }),
      prisma.sourceListing.findMany({
        take: 50,
        orderBy: [{ channel: "asc" }, { title: "asc" }, { externalListingId: "asc" }],
        select: {
          id: true,
          channel: true,
          title: true,
          externalListingId: true,
        },
      }),
      prisma.syncRun.findMany({
        where: { source: "hosthub_poll" },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: {
          id: true,
          startedAt: true,
          completedAt: true,
          status: true,
          source: true,
          statsJson: true,
          cursor: true,
        },
      }),
      prisma.importError.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          code: true,
          message: true,
          createdAt: true,
          syncRunId: true,
        },
      }),
      getHosthubTokenStatus(),
      prisma.booking.count(),
      prisma.booking.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.booking.count({ where: { sourceListingId: null } }),
      prisma.booking.groupBy({
        by: ["channel"],
        _count: { _all: true },
        orderBy: { channel: "asc" },
      }),
    ]);

    let overlapYearUtc:
      | {
          year: number;
          totalStayRowsOverlapping: number;
          withSourceListing: number;
          withoutSourceListing: number;
          note: string;
        }
      | undefined;
    if (overlapYear !== null) {
      const ow = bookingOverlapsUtcCalendarYearWhere(overlapYear);
      const [totalStay, withL, withoutL] = await Promise.all([
        prisma.booking.count({ where: ow }),
        prisma.booking.count({ where: { ...ow, sourceListingId: { not: null } } }),
        prisma.booking.count({ where: { ...ow, sourceListingId: null } }),
      ]);
      overlapYearUtc = {
        year: overlapYear,
        totalStayRowsOverlapping: totalStay,
        withSourceListing: withL,
        withoutSourceListing: withoutL,
        note:
          "withoutSourceListing are invisible in Settings Κρατήσεις; compare withSourceListing to pnpm hosthub:count-bookings -- --overlap-year for the same year.",
      };
    }

    let probe:
      | {
          ok: boolean;
          durationMs: number;
          pageDataLength: number;
          pageSkipped: number;
          hasNextPage: boolean;
          distinctListings: DistinctListing[];
          error?: { code: string; message: string };
        }
      | undefined;

    if (probeHosthub) {
      const started = Date.now();
      const token = await resolveHosthubApiToken();
      if (!token) {
        probe = {
          ok: false,
          durationMs: Date.now() - started,
          pageDataLength: 0,
          pageSkipped: 0,
          hasNextPage: false,
          distinctListings: [],
          error: { code: "NO_TOKEN", message: "Hosthub token is not configured" },
        };
      } else {
        const baseUrl = process.env.HOSTHUB_API_BASE?.trim() ?? "https://app.hosthub.com/api/2019-03-01";
        const listPath = process.env.HOSTHUB_API_RESERVATIONS_PATH?.trim();
        const isVisibleProbe = process.env.HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE?.trim();
        const client = new HosthubClient({
          baseUrl,
          apiToken: token,
          ...(listPath ? { listReservationsPath: listPath } : {}),
        });
        const page = await client.listCalendarEventsPage({
          nextPageUrl: null,
          updatedGte: undefined,
          ...(isVisibleProbe ? { isVisible: isVisibleProbe } : {}),
        });
        const durationMs = Date.now() - started;
        if (!page.ok) {
          probe = {
            ok: false,
            durationMs,
            pageDataLength: 0,
            pageSkipped: 0,
            hasNextPage: false,
            distinctListings: [],
            error: { code: page.error.code, message: page.error.message },
          };
        } else {
          probe = {
            ok: true,
            durationMs,
            pageDataLength: page.value.data.length,
            pageSkipped: page.value.skipped,
            hasNextPage: Boolean(page.value.nextPageUrl),
            distinctListings: distinctListingsFromPage(page.value.data),
          };
        }
      }
    }

    return NextResponse.json({
      data: {
        sourceListings: {
          total,
          byChannel: byChannel.map((g) => ({
            channel: String(g.channel),
            count: g._count._all,
          })),
          sample: sample.map((l) => ({
            id: l.id,
            channel: String(l.channel),
            title: l.title,
            externalListingId: l.externalListingId,
          })),
        },
        bookings: {
          total: bookingTotals,
          withoutSourceListing: bookingsWithoutListing,
          byChannel: bookingsByChannel.map((g) => ({
            channel: String(g.channel),
            count: g._count._all,
          })),
          byStatus: bookingsByStatus.map((g) => ({
            status: String(g.status),
            count: g._count._all,
          })),
          activeCount: bookingsByStatus
            .filter((g) => g.status !== BookingStatus.cancelled)
            .reduce((s, g) => s + g._count._all, 0),
          cancelledCount:
            bookingsByStatus.find((g) => g.status === BookingStatus.cancelled)?._count._all ?? 0,
        },
        excelListingsBookingCounts: {
          semantics:
            "GET /api/excel/listings?year= counts bookings whose stay overlaps that UTC calendar year (check-in inclusive, check-out exclusive), with sourceListingId set. Optional query overlapYear=2000-2100 adds overlapYearUtc counts.",
          ...(overlapYearUtc ? { overlapYearUtc } : {}),
        },
        bookingsListHints: {
          defaultReservationStatusInUi: "all",
          note:
            "GET /api/bookings/list hides cancelled when reservationStatus=active; room filters exclude unassigned bookings.",
        },
        syncRuns: syncRuns.map((r) => ({
          id: r.id,
          startedAt: r.startedAt.toISOString(),
          completedAt: r.completedAt?.toISOString() ?? null,
          status: r.status,
          source: r.source,
          statsJson: r.statsJson,
          cursor: r.cursor,
        })),
        importErrors: importErrors.map((e) => ({
          id: e.id,
          code: e.code,
          message: e.message,
          createdAt: e.createdAt.toISOString(),
          syncRunId: e.syncRunId,
        })),
        hosthubReconcileEnv: {
          HOSTHUB_RECONCILE_FULL_SYNC: process.env.HOSTHUB_RECONCILE_FULL_SYNC ?? null,
          HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE: process.env.HOSTHUB_CALENDAR_EVENTS_IS_VISIBLE ?? null,
          HOSTHUB_SYNC_FETCH_EVENT_ENRICHMENT: process.env.HOSTHUB_SYNC_FETCH_EVENT_ENRICHMENT ?? null,
          HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR: process.env.HOSTHUB_RECONCILE_PER_RENTAL_CALENDAR ?? null,
          note:
            "fullSync omits updated_gte; is_visible=all lists hidden Hosthub events; enrichment=0 skips notes/tax fetches per event; per_rental_calendar=1 also walks each rental's calendar-events after the global list.",
        },
        tokenStatus,
        ...(probe ? { probe } : {}),
      },
    });
  } catch (err) {
    return apiError(
      request,
      "INTERNAL_ERROR",
      "Internal server error",
      500,
      undefined,
      { route: "/api/admin/sync/hosthub/diag", method: "GET" },
      err,
    );
  }
}

export async function GET(request: NextRequest) {
  return withRateLimit("GET:/api/admin/sync/hosthub/diag", DEFAULT_USER_RATE_RULES, request, (req) =>
    getHosthubDiag(req as NextRequest),
  );
}
