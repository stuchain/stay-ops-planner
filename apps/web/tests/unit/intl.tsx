import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import el from "../../messages/el.json";
import en from "../../messages/en.json";

export const MESSAGES = { el, en } as const;
export type TestLocale = keyof typeof MESSAGES;

export function IntlWrapper({ locale = "el", children }: { locale?: TestLocale; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Athens">
      {children}
    </NextIntlClientProvider>
  );
}

/** `render` inside the translation provider (Greek unless `locale` says otherwise). */
export function renderIntl(ui: ReactElement, options: RenderOptions & { locale?: TestLocale } = {}) {
  const { locale = "el", ...rest } = options;
  return render(ui, {
    wrapper: ({ children }) => <IntlWrapper locale={locale}>{children}</IntlWrapper>,
    ...rest,
  });
}

/**
 * Words written only in Latin letters, apart from the names a Greek screen may show
 * (apartments, channels, guests from the test data). Used to prove a screen is fully Greek.
 */
export function latinWords(text: string, allowed: readonly string[] = []): string[] {
  const allow = new Set(
    [...ALWAYS_ALLOWED, ...allowed].flatMap((name) => name.toLowerCase().split(/[^\p{L}\p{N}.]+/u)).filter(Boolean),
  );
  return (text.match(/[A-Za-z][A-Za-z.]*/g) ?? []).filter((word) => !allow.has(word.toLowerCase()));
}

const ALWAYS_ALLOWED = ["Hosthub", "Airbnb", "Booking.com", "Onar", "Cosmos", "Iris", "Helios", "A", "B"];

// Drop-in for "@testing-library/react" whose `render` includes the translation provider.
export * from "@testing-library/react";
export { renderIntl as render };
