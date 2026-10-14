import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { Card } from "@/ui/Card";
import { showToast } from "@/ui/Toast";
import { ChoiceGroup } from "@/ui/ChoiceGroup";

export type TextSize = "normal" | "large" | "xlarge";

export function toTextSize(value: string): TextSize {
  return value === "large" || value === "xlarge" ? value : "normal";
}

/** Normal, large or very large letters. The whole app grows at once, before the save finishes. */
export function TextSizeCard({ textSize }: { textSize: TextSize }) {
  const t = useTranslations("settingsScreen");
  const errorText = useErrorText();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const apply = (size: string) => document.getElementById("new-ui-root")?.setAttribute("data-text-size", size);
  const save = useMutation(
    trpc.me.updatePreferences.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.me.pathKey() });
        router.refresh();
      },
      onError: (error) => {
        apply(textSize);
        showToast({ message: errorText(error), tone: "danger" });
      },
    }),
  );
  return (
    <Card title={t("textSize.title")}>
      <ChoiceGroup<TextSize>
        label={t("textSize.label")}
        value={textSize}
        disabled={save.isPending}
        choices={[
          { value: "normal", label: t("textSize.normal") },
          { value: "large", label: t("textSize.large") },
          { value: "xlarge", label: t("textSize.xlarge") },
        ]}
        onChange={(next) => {
          apply(next);
          save.mutate({ textSize: next });
        }}
      />
      <p className="text-text-muted text-base">{t("textSize.sample")}</p>
    </Card>
  );
}
