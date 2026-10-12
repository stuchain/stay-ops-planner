import { useTranslations } from "next-intl";
import { Skeleton } from "@/ui/Skeleton";

/** Shown at once when moving between screens, while the next one is fetched from the server (slow on a cold start). */
export default function AppLoading() {
  const t = useTranslations("common");
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6" data-testid="app-loading">
      <span className="sr-only">{t("loadingPage")}</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton variant="block" />
      <Skeleton variant="block" />
    </div>
  );
}
