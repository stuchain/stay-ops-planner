import type { Metadata } from "next";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { CleanerDayView } from "@/features/cleaner/CleanerDayView";
import { LinkProblem } from "@/features/cleaner/LinkProblem";
import { getCleanerDay } from "@/server/useCases/cleaningCleanerDay";
import { verifyCleanerToken } from "@/server/useCases/cleaningLink";
import el from "../../../../messages/el.json";
import "@/ui/theme.css";

/** Every visit reads the schedule again: the cleaner must see today's plan, not a saved copy. */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

/** The cleaner reads Greek whatever language the app is set to, so the Greek messages are used directly. */
const t = createTranslator({ locale: "el", messages: el, namespace: "cleanerLink" });

export function generateMetadata(): Metadata {
  return {
    title: t("title"),
    // The address is a secret: keep it out of search engines and out of the referrer of any link followed.
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function CleanerPage({ params }: Props) {
  const { token } = await params;
  const check = verifyCleanerToken(token);
  return (
    <NextIntlClientProvider
      locale="el"
      messages={{ cleanerLink: el.cleanerLink, cleaningCalendar: el.cleaningCalendar, common: el.common, ui: el.ui }}
      timeZone="Europe/Athens"
    >
      <div id="cleaner-root" lang="el" data-ui="new" data-text-size="large">
        {check.ok ? <CleanerDayView data={await getCleanerDay(check.day)} /> : <LinkProblem reason={check.reason} />}
      </div>
    </NextIntlClientProvider>
  );
}
