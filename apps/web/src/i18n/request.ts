import { getRequestConfig } from "next-intl/server";
import { currentUserPreferences } from "@/server/flags";

/** The locale comes from the signed-in user (`users.ui_locale`) on the server, so there is no flash of English. */
export default getRequestConfig(async () => {
  let locale: "el" | "en" = "el";
  try {
    locale = (await currentUserPreferences()).locale;
  } catch {
    // A database hiccup must not break every page: fall back to Greek.
  }
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages, timeZone: "Europe/Athens" };
});
