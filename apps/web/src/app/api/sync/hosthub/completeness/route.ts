import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Channel, PrismaClient } from "@stay-ops/db";
import { AuthError, jsonError } from "@/modules/auth/errors";
import { requireSession } from "@/modules/auth/guard";

const prisma = new PrismaClient();

type CompletenessField = {
  key: string;
  present: number;
  missing: number;
  coveragePct: number;
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10_000) / 100;
}

async function buildChannelCompleteness(channel: Channel) {
  const total = await prisma.booking.count({ where: { channel } });
  const countPresent = async (whereExtra: object) => prisma.booking.count({ where: { channel, ...whereExtra } });

  const presentCounts = {
    guestName: await countPresent({ guestName: { not: null } }),
    guestEmail: await countPresent({ guestEmail: { not: null } }),
    guestPhone: await countPresent({ guestPhone: { not: null } }),
    guestAdults: await countPresent({ guestAdults: { not: null } }),
    guestChildren: await countPresent({ guestChildren: { not: null } }),
    guestInfants: await countPresent({ guestInfants: { not: null } }),
    guestTotal: await countPresent({ guestTotal: { not: null } }),
    totalAmountCents: await countPresent({ totalAmountCents: { not: null } }),
    currency: await countPresent({ currency: { not: null } }),
    cleaningFeeCents: await countPresent({ cleaningFeeCents: { not: null } }),
    taxCents: await countPresent({ taxCents: { not: null } }),
    payoutAmountCents: await countPresent({ payoutAmountCents: { not: null } }),
    guestPaidCents: await countPresent({ guestPaidCents: { not: null } }),
    action: await countPresent({ action: { not: null } }),
    notes: await countPresent({ notes: { not: null } }),
  };

  const fields: CompletenessField[] = Object.entries(presentCounts).map(([key, present]) => ({
    key,
    present,
    missing: Math.max(0, total - present),
    coveragePct: pct(present, total),
  }));

  return {
    channel,
    total,
    fields,
  };
}

export async function GET(request: NextRequest) {
  try {
    requireSession(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(jsonError(err.code, err.message, err.details), { status: err.status });
    }
    throw err;
  }

  const [airbnb, booking, direct] = await Promise.all([
    buildChannelCompleteness(Channel.airbnb),
    buildChannelCompleteness(Channel.booking),
    buildChannelCompleteness(Channel.direct),
  ]);

  return NextResponse.json(
    {
      data: {
        channels: [airbnb, booking, direct],
        compared: {
          airbnbVsBooking: airbnb.fields.map((field) => {
            const bField = booking.fields.find((x) => x.key === field.key);
            const bookingCoverage = bField?.coveragePct ?? 0;
            return {
              key: field.key,
              airbnbCoveragePct: field.coveragePct,
              bookingCoveragePct: bookingCoverage,
              gapPctPoints: Math.round((field.coveragePct - bookingCoverage) * 100) / 100,
            };
          }),
        },
      },
    },
    { status: 200 },
  );
}
