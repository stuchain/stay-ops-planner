import { render, screen } from "../intl";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/ui/Button";

async function noViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
}

describe("Button", () => {
  it.each(["primary", "secondary", "ghost", "danger"] as const)("renders %s", async (variant) => {
    const { container } = render(<Button variant={variant}>Αποθήκευση</Button>);
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeEnabled();
    await noViolations(container);
  });

  it("uses the 44px and 56px sizes", () => {
    render(
      <>
        <Button size="md">Μικρό</Button>
        <Button size="lg">Μεγάλο</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Μικρό" }).className).toContain("min-h-target");
    expect(screen.getByRole("button", { name: "Μεγάλο" }).className).toContain("min-h-button");
  });

  it("shows a leading icon and calls onClick", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button icon={Plus} onClick={onClick}>
        Νέα κράτηση
      </Button>,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    await noViolations(container);
  });

  it("is disabled and announces the loading label when loading", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Αποθήκευση
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Παρακαλώ περιμένετε")).toHaveClass("sr-only");
    expect(screen.getByText("Αποθήκευση")).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    await noViolations(container);
  });
});
