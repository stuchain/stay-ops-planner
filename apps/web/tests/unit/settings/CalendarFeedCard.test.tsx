import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { describe, expect, it } from "vitest";
import { TRPCProvider } from "@/api/client";
import { CalendarFeedCard, feedLinks } from "@/features/settings/CalendarFeedCard";
import type { AppRouter } from "@/server/api/root";
import { latinWords, render, screen, waitFor } from "../intl";

const PATH = "/feed/user1.abc.ics";

function setup(feed: { path: string; createdAt: string } | null) {
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    "me.calendarFeed": feed,
    "me.createCalendarFeed": { path: PATH, createdAt: "2026-10-12T06:00:00Z" },
    "me.removeCalendarFeed": { ok: true },
  };
  const link: TRPCLink<AppRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        calls.push(op.path);
        observer.next({ result: { data: answers[op.path] } });
        observer.complete();
      });
  const client = createTRPCClient<AppRouter>({ links: [link] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>
        <CalendarFeedCard />
      </TRPCProvider>
    </QueryClientProvider>,
  );
  return { calls };
}

describe("CalendarFeedCard", () => {
  it("builds the iPhone and Google addresses from the feed path", () => {
    const links = feedLinks(PATH, "https://stay.example.com");
    expect(links.https).toBe("https://stay.example.com/feed/user1.abc.ics");
    expect(links.webcal).toBe("webcal://stay.example.com/feed/user1.abc.ics");
    expect(links.google).toBe(
      "https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fstay.example.com%2Ffeed%2Fuser1.abc.ics",
    );
  });

  it("offers to make a link when there is none, in Greek", async () => {
    const { calls } = setup(null);
    const create = await screen.findByRole("button", { name: "Δημιουργία συνδέσμου" });
    expect(latinWords(document.body.textContent ?? "")).toEqual([]);
    create.click();
    await waitFor(() => expect(calls).toContain("me.createCalendarFeed"));
  });

  it("shows the link and the phone buttons, and asks before switching it off", async () => {
    const { calls } = setup({ path: PATH, createdAt: "2026-10-12T06:00:00Z" });
    const iphone = await screen.findByRole("link", { name: "Προσθήκη στο iPhone" });
    expect(iphone.getAttribute("href")).toMatch(/^webcal:\/\/.+\/feed\/user1\.abc\.ics$/);
    expect(screen.getByRole("link", { name: "Προσθήκη στο Google Calendar" }).getAttribute("href")).toContain(
      "calendar.google.com",
    );
    screen.getByRole("button", { name: "Απενεργοποίηση" }).click();
    await screen.findByText(/θα φύγουν από το ημερολόγιο/);
    expect(calls).not.toContain("me.removeCalendarFeed");
    screen.getByRole("button", { name: "Ναι" }).click();
    await waitFor(() => expect(calls).toContain("me.removeCalendarFeed"));
  });
});
