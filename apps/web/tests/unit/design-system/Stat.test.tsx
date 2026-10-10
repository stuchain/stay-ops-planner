import { render, screen } from "../intl";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { Stat } from "@/ui/Stat";

describe("Stat", () => {
  it.each(["neutral", "success", "warning", "danger"] as const)("renders tone %s", async (tone) => {
    const { container } = render(<Stat label="Έσοδα" value="1.250 €" hint="Αυτόν τον μήνα" tone={tone} />);
    expect(screen.getByText("Έσοδα")).toBeInTheDocument();
    expect(screen.getByText("1.250 €")).toBeInTheDocument();
    expect(screen.getByText("Αυτόν τον μήνα")).toBeInTheDocument();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("omits the hint when not given", () => {
    render(<Stat label="Κρατήσεις" value={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
