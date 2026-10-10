import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm, waitMinutes } from "@/app/login/LoginForm";
import { latinWords, render, screen, waitFor } from "../intl";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

async function submit() {
  const user = userEvent.setup();
  await user.type(screen.getByTestId("login-email"), "a@b.gr");
  await user.type(screen.getByTestId("login-password"), "secret");
  await user.click(screen.getByTestId("login-submit"));
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  push.mockClear();
  setOnline(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  it("is fully Greek", () => {
    const { container } = render(<LoginForm />);
    expect(screen.getByRole("heading", { level: 1, name: "Σύνδεση" })).toBeInTheDocument();
    expect(screen.getByLabelText("Ηλεκτρονική διεύθυνση")).toBeInTheDocument();
    expect(screen.getByLabelText("Κωδικός")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Είσοδος" })).toBeInTheDocument();
    expect(latinWords(container.textContent ?? "")).toEqual([]);
  });

  it("is English when the locale is English", () => {
    render(<LoginForm />, { locale: "en" });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("goes to the app after a good sign-in", async () => {
    vi.stubGlobal("fetch", reply(200, { data: {} }));
    render(<LoginForm />);
    await submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });

  it("says in minutes when to try again after a lockout", async () => {
    vi.stubGlobal("fetch", reply(429, { error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 170 } } }));
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Δοκιμάστε ξανά σε 3 λεπτά");
  });

  it("uses the singular for one minute", async () => {
    vi.stubGlobal("fetch", reply(429, { error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 20 } } }));
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Δοκιμάστε ξανά σε 1 λεπτό");
  });

  it("tells a wrong password in words, never the server text", async () => {
    vi.stubGlobal("fetch", reply(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }));
    render(<LoginForm />);
    await submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("δεν είναι σωστά");
    expect(latinWords(alert.textContent ?? "")).toEqual([]);
  });

  it("says there is no internet when the request cannot be sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Δεν υπάρχει σύνδεση στο internet");
  });

  it("says there is no internet at once when the browser is offline, without trying", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setOnline(false);
    render(<LoginForm />);
    expect(await screen.findByTestId("login-offline")).toHaveTextContent("Δεν υπάρχει σύνδεση στο internet");
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Δεν υπάρχει σύνδεση στο internet");
  });
});

describe("waitMinutes", () => {
  it("rounds up and is never below one", () => {
    expect(waitMinutes(1)).toBe(1);
    expect(waitMinutes(60)).toBe(1);
    expect(waitMinutes(61)).toBe(2);
    expect(waitMinutes(900)).toBe(15);
    expect(waitMinutes(undefined)).toBe(1);
  });
});
