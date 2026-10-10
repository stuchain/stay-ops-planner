import { render, screen } from "../intl";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "@/ui/ErrorState";

describe("ErrorState", () => {
  it("is an alert with a Greek retry button", async () => {
    const onRetry = vi.fn();
    const { container } = render(<ErrorState message="Η φόρτωση απέτυχε." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Η φόρτωση απέτυχε.");
    await userEvent.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("accepts a custom retry label", () => {
    render(<ErrorState message="Σφάλμα" onRetry={() => {}} retryLabel="Ξανά" />);
    expect(screen.getByRole("button", { name: "Ξανά" })).toBeInTheDocument();
  });
});
