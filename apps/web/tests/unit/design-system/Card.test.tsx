import { render, screen } from "../intl";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { Card } from "@/ui/Card";

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}

describe("Card", () => {
  it("renders title, actions and content", async () => {
    const { container } = render(
      <Card title="Σήμερα" actions={<button type="button">Περισσότερα</button>}>
        Περιεχόμενο
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Σήμερα" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Περισσότερα" })).toBeInTheDocument();
    expect(screen.getByText("Περιεχόμενο")).toBeInTheDocument();
    await noViolations(container);
  });

  it("renders without a header", () => {
    render(<Card>Μόνο περιεχόμενο</Card>);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
