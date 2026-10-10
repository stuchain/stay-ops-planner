// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { PageHeader } from "@/ui/PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders title, subtitle and actions", async () => {
    const { container } = render(
      <PageHeader title="Ημερολόγιο" subtitle="Οκτώβριος 2026" actions={<button>Νέα κράτηση</button>} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ημερολόγιο" })).toBeInTheDocument();
    expect(screen.getByText("Οκτώβριος 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Νέα κράτηση" })).toBeInTheDocument();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("renders title only", () => {
    render(<PageHeader title="Έσοδα" />);
    expect(screen.getByRole("heading", { name: "Έσοδα" })).toBeInTheDocument();
  });
});
