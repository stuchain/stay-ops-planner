import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { isoDate } from "@stay-ops/domain";
import { DateText } from "@/ui/DateText";

describe("DateText", () => {
  it("renders a day in a <time> element", () => {
    render(<DateText date={isoDate("2025-10-17")} />);
    const el = screen.getByText("Παρ 17 Οκτ");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("datetime", "2025-10-17");
  });

  it("renders the year, a range with nights, and English", () => {
    const { container } = render(
      <div>
        <DateText date={isoDate("2026-10-17")} withYear />
        <DateText date={isoDate("2025-10-31")} to={isoDate("2025-11-04")} showNights />
        <DateText date={isoDate("2025-10-17")} locale="en" />
      </div>,
    );
    expect(container).toHaveTextContent("Σαβ 17 Οκτ 2026");
    expect(container).toHaveTextContent("Παρ 31 Οκτ – Τρι 4 Νοε · 4 νύχτες");
    expect(container).toHaveTextContent("Fri 17 Oct");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<DateText date={isoDate("2025-10-17")} to={isoDate("2025-10-21")} />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
