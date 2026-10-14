import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { Card } from "@/ui/Card";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { showToast } from "@/ui/Toast";

export type Theme = "light" | "dark" | "system";

export function toTheme(value: string): Theme {
  return value === "dark" || value === "system" ? value : "light";
}

/** Light, dark or follow the device. Saved per person, so it never changes anyone else's screen. */
export function ThemeCard({ theme }: { theme: Theme }) {
  const t = useTranslations("settingsScreen");
  const errorText = useErrorText();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const apply = (next: string) => document.getElementById("new-ui-root")?.setAttribute("data-theme", next);
  const save = useMutation(
    trpc.me.updatePreferences.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.me.pathKey() });
        router.refresh();
      },
      onError: (error) => {
        apply(theme);
        showToast({ message: errorText(error), tone: "danger" });
      },
    }),
  );
  return (
    <Card title={t("theme.title")}>
      <ChoiceGroup<Theme>
        label={t("theme.label")}
        value={theme}
        disabled={save.isPending}
        choices={[
          { value: "light", label: t("theme.light") },
          { value: "dark", label: t("theme.dark") },
          { value: "system", label: t("theme.system") },
        ]}
        onChange={(next) => {
          apply(next);
          save.mutate({ theme: next });
        }}
      />
      <p className="text-text-muted text-base">{t("theme.hint")}</p>
    </Card>
  );
}
