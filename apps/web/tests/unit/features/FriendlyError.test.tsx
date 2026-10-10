import { describe, expect, it, vi } from "vitest";
import { FriendlyError } from "@/features/errors/FriendlyError";
import { latinWords, render, screen } from "../intl";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

describe("FriendlyError (E2-5)", () => {
  it("offers a Greek retry that refreshes and resets", () => {
    const onRetry = vi.fn();
    render(<FriendlyError kind="error" onRetry={onRetry} />);
    expect(latinWords(document.body.textContent ?? "")).toEqual([]);
    screen.getByRole("button").click();
    expect(refresh).toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalled();
  });

  it.each(["notFound", "forbidden"] as const)("sends %s home", (kind) => {
    render(<FriendlyError kind={kind} />);
    screen.getByRole("button").click();
    expect(push).toHaveBeenCalledWith("/app");
  });
});
