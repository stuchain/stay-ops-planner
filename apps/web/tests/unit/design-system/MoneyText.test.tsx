import { describe, expect, it } from "vitest";
import { render } from "../intl";
import axe from "axe-core";
import { MoneyText } from "@/ui/MoneyText";

describe("MoneyText", () => {
  it("formats cents", () => {
    const { container } = render(
      <div>
        <MoneyText cents={125000} />
        <MoneyText cents={1250} />
        <MoneyText cents={125000} locale="en" />
      </div>,
    );
    const texts = Array.from(container.querySelectorAll("span")).map((s) => s.textContent);
    expect(texts).toEqual(["1.250 €", "12,50 €", "€1,250"]);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<MoneyText cents={125000} />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
