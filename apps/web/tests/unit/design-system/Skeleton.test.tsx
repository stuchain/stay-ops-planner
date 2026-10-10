import { render } from "../intl";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { Skeleton } from "@/ui/Skeleton";

describe("Skeleton", () => {
  it.each(["line", "block", "bar"] as const)("is hidden from assistive tech (%s)", async (variant) => {
    const { container } = render(<Skeleton variant={variant} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild?.className).toContain("motion-safe:animate-pulse");
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
