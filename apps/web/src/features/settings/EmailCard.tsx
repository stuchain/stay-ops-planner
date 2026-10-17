import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { cn } from "@/ui/cn";
import { fieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { FoldCard } from "./FoldCard";

/**
 * The e-mail used to sign in, changed with the current password. Nothing is sent to it, so it can be an address
 * nobody else knows: then a stranger can't guess at the sign-in.
 */
export function EmailCard() {
  const t = useTranslations("settingsScreen.email");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ids = useId();
  const [next, setNext] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const change = useMutation(
    trpc.me.changeEmail.mutationOptions({
      meta: { handlesErrors: true },
      onSuccess: () => {
        setNext("");
        setPassword("");
        setProblem(null);
        setDone(true);
        void queryClient.invalidateQueries({ queryKey: trpc.me.get.queryKey() });
      },
      onError: (error) => {
        setDone(false);
        setProblem(errorText(error));
      },
    }),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    if (!next.trim() || !password) return setProblem(t("fillAll"));
    setProblem(null);
    change.mutate({ newEmail: next.trim(), currentPassword: password });
  }

  return (
    <FoldCard summary={t("title")} testId="settings-email">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-text-muted text-sm">{t("why")}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-email`} className="text-base font-medium">
            {t("next")}
          </label>
          <input
            id={`${ids}-email`}
            type="email"
            value={next}
            autoComplete="username"
            onChange={(e) => setNext(e.target.value)}
            className={cn(fieldClass, "w-full max-w-md")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-password`} className="text-base font-medium">
            {t("password")}
          </label>
          <input
            id={`${ids}-password`}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className={cn(fieldClass, "w-full max-w-md")}
          />
        </div>
        {problem ? (
          <p role="alert" className="bg-danger-soft text-text rounded-sm p-4 text-base font-medium">
            {problem}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="bg-success-soft text-success-text rounded-sm p-4 text-base font-medium">
            {t("done")}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            icon={AtSign}
            loading={change.isPending}
            loadingLabel={t("saving")}
          >
            {t("submit")}
          </Button>
        </div>
      </form>
    </FoldCard>
  );
}
