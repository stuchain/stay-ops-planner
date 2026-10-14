import { describe, expect, it } from "vitest";
import { render, screen } from "../intl";
import axe from "axe-core";
import { ApartmentChip } from "@/ui/ApartmentChip";

describe("ApartmentChip", () => {
  it("shows the name and passes the colour through a custom property", async () => {
    const { container } = render(<ApartmentChip name="Onar" color="#0F766E" />);
    const chip = screen.getByText("Onar").parentElement!;
    // An approved apartment colour goes through its theme-aware variable (lighter in dark mode).
    expect(chip.style.getPropertyValue("--apt")).toBe("var(--so-apt-onar)");
    expect(screen.queryByText(/Απενεργοποιημένο/)).toBeNull();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("keeps any other colour, and uses the muted colour when there is none", () => {
    render(
      <>
        <ApartmentChip name="Extra" color="#123456" />
        <ApartmentChip name="Plain" color={null} />
      </>,
    );
    expect(screen.getByText("Extra").parentElement!.style.getPropertyValue("--apt")).toBe("#123456");
    expect(screen.getByText("Plain").parentElement!.style.getPropertyValue("--apt")).toBe("var(--so-text-muted)");
  });

  it("shows the inactive word", async () => {
    const { container } = render(<ApartmentChip name="Helios" color="#A65F00" inactive />);
    expect(screen.getByText(/Απενεργοποιημένο/)).toBeInTheDocument();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
