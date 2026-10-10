import { render, screen } from "../intl";
import axe from "axe-core";
import { Plus } from "lucide-react";
import { describe, expect, it } from "vitest";
import { IconButton } from "@/ui/IconButton";

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}

describe("IconButton", () => {
  it.each(["primary", "secondary", "ghost", "danger"] as const)(
    "has an accessible name and a 44px target (%s)",
    async (variant) => {
      const { container } = render(<IconButton label="Προσθήκη" icon={Plus} variant={variant} />);
      const button = screen.getByRole("button", { name: "Προσθήκη" });
      expect(button.className).toContain("h-target");
      expect(button.className).toContain("w-target");
      await noViolations(container);
    },
  );

  it("is disabled while loading", async () => {
    const { container } = render(<IconButton label="Προσθήκη" icon={Plus} loading />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName("Προσθήκη – Παρακαλώ περιμένετε");
    await noViolations(container);
  });
});
