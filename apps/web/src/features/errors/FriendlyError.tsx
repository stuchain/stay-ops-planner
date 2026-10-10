"use client";

import { Home, RotateCw, ShieldOff, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import "@/ui/theme.css";

export type FriendlyErrorKind = "error" | "notFound" | "forbidden";

const ICONS: Record<FriendlyErrorKind, LucideIcon> = { error: TriangleAlert, notFound: Home, forbidden: ShieldOff };

/**
 * The page shown when something breaks, a page does not exist or the person may not see it (E2-5):
 * a sentence a person would say, never the server's error text.
 */
export function FriendlyError({ kind, onRetry }: { kind: FriendlyErrorKind; onRetry?: () => void }) {
  const t = useTranslations(`errorPage.${kind}`);
  const tCommon = useTranslations("errorPage");
  const router = useRouter();
  const action =
    kind === "error" ? (
      <Button
        variant="primary"
        size="lg"
        icon={RotateCw}
        onClick={() => {
          router.refresh();
          onRetry?.();
        }}
      >
        {tCommon("retry")}
      </Button>
    ) : (
      <Button variant="primary" size="lg" icon={Home} onClick={() => router.push("/app")}>
        {tCommon("home")}
      </Button>
    );
  return (
    <div data-ui="new" className="bg-bg text-text flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState icon={ICONS[kind]} title={t("title")} text={t("text")} action={action} />
    </div>
  );
}
