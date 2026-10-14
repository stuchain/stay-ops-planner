import { describe, expect, it } from "vitest";
import { render, screen } from "../intl";
import axe from "axe-core";
import { ApartmentChip } from "@/ui/ApartmentChip";

describe("ApartmentChip", () => {
  it("shows the name with no apartment colour", async () => {
    const { container } = render(<ApartmentChip name="Onar" />);
    const chip = screen.getByText("Onar").parentElement!;
    expect(chip.getAttribute("style")).toBeNull();
    expect(chip.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByText(/Απενεργοποιημένο/)).toBeNull();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("shows the inactive word", async () => {
    const { container } = render(<ApartmentChip name="Helios" inactive />);
    expect(screen.getByText(/Απενεργοποιημένο/)).toBeInTheDocument();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
