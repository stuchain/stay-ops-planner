import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { ApartmentChip } from "@/ui/ApartmentChip";

describe("ApartmentChip", () => {
  it("shows the name and passes the colour through a custom property", async () => {
    const { container } = render(<ApartmentChip name="Onar" color="#0F766E" />);
    const chip = screen.getByText("Onar").parentElement!;
    expect(chip.style.getPropertyValue("--apt")).toBe("#0F766E");
    expect(screen.queryByText(/Απενεργοποιημένο/)).toBeNull();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("shows the inactive word", async () => {
    const { container } = render(<ApartmentChip name="Helios" color="#A65F00" inactive />);
    expect(screen.getByText(/Απενεργοποιημένο/)).toBeInTheDocument();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
