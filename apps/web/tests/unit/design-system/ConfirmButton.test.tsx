import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../intl";
import { ConfirmButton } from "@/ui/ConfirmButton";

describe("ConfirmButton", () => {
  it("asks first and runs only on yes", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton question="Επαναφορά;" onConfirm={onConfirm}>
        Επαναφορά
      </ConfirmButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Επαναφορά" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Επαναφορά;")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Όχι" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Επαναφορά;")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Επαναφορά" }));
    await userEvent.click(screen.getByRole("button", { name: "Ναι" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
