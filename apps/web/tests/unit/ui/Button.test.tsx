import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/modules/ui/Button";

describe("Button", () => {
  it("fires click when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Go
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows loading label and blocks click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Working…" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
