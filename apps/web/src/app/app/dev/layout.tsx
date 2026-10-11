import { ShieldOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/ui/EmptyState";
import { currentUserPreferences } from "@/server/userPreferences";

/** Dev mode pages: shown to an admin with Dev mode on. The tRPC procedures check the role again. */
export default async function DevLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const prefs = await currentUserPreferences();
  if (prefs.devMode) return children;
  const t = await getTranslations("dev.noAccess");
  return <EmptyState icon={ShieldOff} title={t("title")} text={t("text")} className="py-24" />;
}
