import type messages from "../../messages/el.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: "el" | "en";
    Messages: typeof messages;
  }
}
