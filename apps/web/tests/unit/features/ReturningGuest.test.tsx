import { describe, expect, it } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { PreviousStays } from "@/api/types";
import { ReturningLines } from "@/features/calendar/ReturningGuest";
import { render, screen } from "../intl";

const stay = (checkin: string, apartment: string | null) => ({
  bookingId: checkin,
  checkin: checkin as IsoDate,
  apartment,
});

describe("ReturningLines", () => {
  it("shows nothing for a new guest", () => {
    const { container } = render(<ReturningLines previous={{ sure: [], maybe: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the apartment and month, and the weaker name hint", () => {
    const previous: PreviousStays = {
      sure: [stay("2025-08-03", "Cosmos")],
      maybe: [stay("2024-05-10", "Iris")],
    };
    render(<ReturningLines previous={previous} />);
    expect(screen.getByText("Έχει ξαναέρθει: Cosmos, Αύγουστος 2025")).toBeInTheDocument();
    expect(screen.getByText("Ίσως έχει ξαναέρθει (ίδιο όνομα): Iris, Μάιος 2024")).toBeInTheDocument();
  });

  it("shows three stays and counts the rest, and names a stay without apartment", () => {
    const previous: PreviousStays = {
      sure: [
        stay("2025-08-03", "Cosmos"),
        stay("2025-07-03", null),
        stay("2025-06-03", "Onar"),
        stay("2025-05-03", "Onar"),
        stay("2025-04-03", "Onar"),
      ],
      maybe: [],
    };
    render(<ReturningLines previous={previous} />);
    expect(
      screen.getByText(
        "Έχει ξαναέρθει: Cosmos, Αύγουστος 2025; χωρίς διαμέρισμα, Ιούλιος 2025; Onar, Ιούνιος 2025 +2 ακόμα",
      ),
    ).toBeInTheDocument();
  });
});
