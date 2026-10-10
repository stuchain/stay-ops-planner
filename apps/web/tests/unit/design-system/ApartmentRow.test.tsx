import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { ApartmentRow } from "@/ui/ApartmentRow";

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}

describe("ApartmentRow", () => {
  it("default: name, capacity, children, 88px row", async () => {
    const { container } = render(
      <ApartmentRow name="Onar" color="#0F766E" capacity={4}>
        <div>track</div>
      </ApartmentRow>,
    );
    expect(screen.getByText("έως 4 άτομα")).toBeInTheDocument();
    expect(screen.getByText("track")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Onar" })).toHaveClass("h-row");
    expect(screen.queryByText("Ελεύθερο")).toBeNull();
    await expectNoViolations(container);
  });

  it("free drop state", async () => {
    const { container } = render(<ApartmentRow name="Cosmos" color="#4338CA" capacity={3} dropState="free" />);
    expect(screen.getByText("Ελεύθερο")).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("busy drop state names the guest", async () => {
    const { container } = render(
      <ApartmentRow name="Iris" color="#BE185D" capacity={3} dropState="busy" busyGuest="Νίκος Π." />,
    );
    expect(screen.getByText("Κλεισμένο: Νίκος Π.")).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it("inactive wins over drop state", async () => {
    const { container } = render(<ApartmentRow name="Helios" color="#A65F00" capacity={2} inactive dropState="free" />);
    expect(screen.getByText(/Απενεργοποιημένο/)).toBeInTheDocument();
    expect(screen.queryByText("Ελεύθερο")).toBeNull();
    await expectNoViolations(container);
  });
});
