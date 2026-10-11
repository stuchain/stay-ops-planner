import { describe, expect, it } from "vitest";
import type { IsoDate } from "@stay-ops/domain";
import type { CleanerDay } from "@/api/types";
import { CleanerDayView } from "@/features/cleaner/CleanerDayView";
import { LinkProblem } from "@/features/cleaner/LinkProblem";
import { latinWords, render, screen } from "../intl";

const day: CleanerDay = {
  day: "2030-06-10" as IsoDate,
  tasks: [
    {
      id: "t1",
      apartment: "Onar",
      color: "#0F766E",
      status: "todo",
      leaveTime: "11:00",
      start: "11:00",
      end: "13:00",
      arrival: { sameDay: true, day: "2030-06-10" as IsoDate, time: "15:00", adults: 2, children: 0, infants: 1 },
      assigneeName: "Ελένη",
      notes: "Αλλάξτε τα σεντόνια",
    },
    {
      id: "t2",
      apartment: "Iris",
      color: null,
      status: "done",
      leaveTime: "11:00",
      start: "11:00",
      end: "13:00",
      arrival: null,
      assigneeName: null,
      notes: null,
    },
  ],
};

describe("CleanerDayView", () => {
  it("shows the day in Greek, with no guest details", () => {
    const { container } = render(<CleanerDayView data={day} />);
    expect(screen.getByRole("heading", { level: 1, name: "Πρόγραμμα καθαρισμού" })).toBeInTheDocument();
    expect(screen.getByText("Την ίδια μέρα στις 15:00")).toBeInTheDocument();
    expect(screen.getByText("2 ενήλικες, 1 βρέφος")).toBeInTheDocument();
    expect(screen.getByText("Κανείς δεν έρχεται")).toBeInTheDocument();
    expect(screen.getByText("Αλλάξτε τα σεντόνια")).toBeInTheDocument();
    expect(screen.getByText("Έγινε")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Εκτύπωση" })).toBeInTheDocument();
    expect(latinWords(container.textContent ?? "")).toEqual([]);
  });

  it("says so when there is nothing to clean", () => {
    render(<CleanerDayView data={{ ...day, tasks: [] }} />);
    expect(screen.getByText("Δεν υπάρχει καθάρισμα αυτή τη μέρα.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Εκτύπωση" })).not.toBeInTheDocument();
  });
});

describe("LinkProblem", () => {
  it("is friendly for an expired or an invalid link", () => {
    const { rerender } = render(<LinkProblem reason="expired" />);
    expect(screen.getByText("Ο σύνδεσμος έχει λήξει")).toBeInTheDocument();
    rerender(<LinkProblem reason="invalid" />);
    expect(screen.getByText("Ο σύνδεσμος δεν ισχύει")).toBeInTheDocument();
    expect(screen.getByText("Ζητήστε νέο σύνδεσμο από τον υπεύθυνο.")).toBeInTheDocument();
  });
});
