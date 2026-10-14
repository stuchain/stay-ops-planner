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
      apartment: "1 - Onar",
      status: "todo",
      kind: "AA",
      people: { adults: 2, children: 1 },
      nobodyBooked: false,
    },
    { id: "t2", apartment: "3 - Iris", status: "done", kind: "A", people: null, nobodyBooked: true },
    {
      id: "t3",
      apartment: "2 - Cosmos",
      status: "todo",
      kind: "S",
      people: { adults: 1, children: 0 },
      nobodyBooked: false,
    },
  ],
};

describe("CleanerDayView", () => {
  it("shows the day in Greek with the kind and how many people, and no times or names", () => {
    const { container } = render(<CleanerDayView data={day} />);
    expect(screen.getByRole("heading", { level: 1, name: "Πρόγραμμα καθαρισμού" })).toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("1 - Onar");
    expect(cards[0]).toHaveTextContent("A-AΑναχώρηση και άφιξη");
    expect(cards[0]).toHaveTextContent("Έρχονται2 ενήλικες, 1 παιδί");
    expect(cards[1]).toHaveTextContent("Δεν έχει κράτηση ακόμα");
    expect(cards[1]).toHaveTextContent("Έγινε");
    expect(cards[2]).toHaveTextContent("Μένουν1 ενήλικας");
    expect(container.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(screen.getByRole("button", { name: "Εκτύπωση" })).toBeInTheDocument();
    // Every piece of text is Greek, apart from the apartment names and the A-A / A / S letters.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const words: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      words.push(...latinWords(node.textContent ?? "", ["A-A", "S"]));
    expect(words).toEqual([]);
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
