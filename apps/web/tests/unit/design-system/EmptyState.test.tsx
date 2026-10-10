import { render, screen } from "../intl";
import axe from "axe-core";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/ui/EmptyState";

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}

describe("EmptyState", () => {
  it("renders icon, title, text and action", async () => {
    const { container } = render(
      <EmptyState
        icon={Inbox}
        title="Καμία κράτηση"
        text="Δεν υπάρχουν κρατήσεις."
        action={<button type="button">Προσθήκη</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Καμία κράτηση" })).toBeInTheDocument();
    expect(screen.getByText("Δεν υπάρχουν κρατήσεις.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Προσθήκη" })).toBeInTheDocument();
    await noViolations(container);
  });

  it("works with only icon and title", async () => {
    const { container } = render(<EmptyState icon={Inbox} title="Τίποτα εδώ" />);
    await noViolations(container);
  });
});
