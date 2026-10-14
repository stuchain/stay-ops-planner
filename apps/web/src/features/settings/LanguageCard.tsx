import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { showToast } from "@/ui/Toast";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { FoldCard } from "./FoldCard";

type Locale = "el" | "en";

/**
 * Greek or English, folded under "Γλώσσα · Ελληνικά" since it is rarely changed. Saved on the user; the server
 * renders the new language after a refresh.
 */
export function LanguageCard({ locale }: { locale: Locale }) {
  const t = useTranslations("settingsScreen");
  const errorText = useErrorText();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(
    trpc.me.updatePreferences.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.me.pathKey() });
        router.refresh();
      },
      onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
    }),
  );
  return (
    <FoldCard summary={t("language.summary", { language: t(`language.${locale}`) })} testId="settings-language">
      <ChoiceGroup<Locale>
        label={t("language.label")}
        value={locale}
        disabled={save.isPending}
        choices={[
          { value: "el", label: t("language.el") },
          { value: "en", label: t("language.en") },
        ]}
        onChange={(next) => save.mutate({ locale: next })}
      />
    </FoldCard>
  );
}
