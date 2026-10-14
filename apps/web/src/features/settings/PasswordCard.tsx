import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import { cn } from "@/ui/cn";
import { fieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { FoldCard } from "./FoldCard";

/** Same as PASSWORD_MIN_LENGTH on the server; the server has the final word. */
const MIN_LENGTH = 8;

function Field({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-base font-medium">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldClass, "w-full max-w-md")}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-text-muted text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Current password, new password twice, folded under its heading until opened. Messages are in words; the server
 * checks the current one.
 */
export function PasswordCard() {
  const t = useTranslations("settingsScreen.password");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const change = useMutation(
    trpc.me.changePassword.mutationOptions({
      onSuccess: () => {
        setCurrent("");
        setNext("");
        setRepeat("");
        setProblem(null);
        setDone(true);
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
    if (!current || !next || !repeat) return setProblem(t("fillAll"));
    if (next !== repeat) return setProblem(t("mismatch"));
    setProblem(null);
    change.mutate({ currentPassword: current, newPassword: next });
  }

  return (
    <FoldCard summary={t("title")} testId="settings-password">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t("current")} value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field
          label={t("next")}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={t("hint", { min: MIN_LENGTH })}
        />
        <Field label={t("repeat")} value={repeat} onChange={setRepeat} autoComplete="new-password" />
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
            icon={KeyRound}
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
