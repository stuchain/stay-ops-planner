import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { showToast } from "@/ui/Toast";

/** The admin-only Dev mode switch. It only saves the flag; the server refuses anyone who is not an admin. */
export function DevModeCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settingsScreen");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(
    trpc.me.setDevMode.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.me.pathKey() }),
      onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    }),
  );
  return (
    <Card title={t("dev.title")}>
      <p className="text-text-muted text-base">{t("dev.description")}</p>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("dev.switch")}
        disabled={save.isPending}
        onClick={() => save.mutate({ enabled: !enabled })}
        className="min-h-button inline-flex items-center gap-3 self-start rounded-sm px-1 text-base font-semibold disabled:opacity-55"
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex h-8 w-14 items-center rounded-full p-1 transition-colors",
            enabled ? "bg-accent justify-end" : "bg-border justify-start",
          )}
        >
          <span className="shadow-card h-6 w-6 rounded-full bg-white" />
        </span>
        <span>{enabled ? t("dev.on") : t("dev.off")}</span>
      </button>
    </Card>
  );
}
