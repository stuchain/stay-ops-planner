"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { FamilyMemberData } from "@/api/types";
import { fieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { cn } from "@/ui/cn";
import { ErrorState } from "@/ui/ErrorState";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";

/** Same as PASSWORD_MIN_LENGTH on the server; the server has the final word. */
const MIN_LENGTH = 8;

const inputClass = `${fieldClass} w-full max-w-md`;

function MemberRow({ member }: { member: FamilyMemberData }) {
  const t = useTranslations("family");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setActive = useMutation(
    trpc.admin.family.setActive.mutationOptions({
      onSuccess: (_result, input) =>
        showToast({ message: input.active ? t("turnedOn") : t("turnedOff"), tone: "success" }),
      onError: (error) => showToast({ message: errorText(error), tone: "danger" }),
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.admin.family.list.pathKey() }),
    }),
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className={cn("min-w-0 break-all", !member.isActive && "text-text-muted")}>
        <span className="font-semibold">{member.email}</span>
        <span className="text-sm"> · {member.isActive ? t("active") : t("off")}</span>
      </span>
      <Button
        variant={member.isActive ? "ghost" : "secondary"}
        loading={setActive.isPending}
        onClick={() => setActive.mutate({ userId: member.id, active: !member.isActive })}
      >
        {member.isActive ? t("turnOff") : t("turnOn")}
      </Button>
    </li>
  );
}

/**
 * Admins only: family members get a read-only account that shows Today, the calendar, the week, search and
 * cleanings, never money, and cannot change anything.
 */
export function FamilyCard() {
  const t = useTranslations("family");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ids = useId();
  const list = useQuery(trpc.admin.family.list.queryOptions());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [locale, setLocale] = useState<"el" | "en">("el");
  const [problem, setProblem] = useState<string | null>(null);
  const add = useMutation(
    trpc.admin.family.add.mutationOptions({
      onSuccess: (member) => {
        setEmail("");
        setPassword("");
        setProblem(null);
        showToast({ message: t("added", { email: member.email }), tone: "success" });
      },
      onError: (error) => setProblem(errorText(error)),
      onSettled: () => void queryClient.invalidateQueries({ queryKey: trpc.admin.family.list.pathKey() }),
    }),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return setProblem(t("fillAll"));
    if (password.length < MIN_LENGTH) return setProblem(t("tooShort", { min: MIN_LENGTH }));
    setProblem(null);
    add.mutate({ email: email.trim(), password, locale });
  }

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-4">
        <p className="text-base">{t("intro")}</p>
        {list.isError ? (
          <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <Skeleton variant="block" className="h-16" />
        ) : list.data.members.length === 0 ? (
          <p className="text-text-muted">{t("noneYet")}</p>
        ) : (
          <ul className="divide-border divide-y" aria-label={t("listLabel")}>
            {list.data.members.map((m) => (
              <MemberRow key={m.id} member={m} />
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="border-border flex flex-col gap-4 border-t pt-4" noValidate>
          <h3 className="text-base font-semibold">{t("addTitle")}</h3>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-email`} className="text-base font-medium">
              {t("email")}
            </label>
            <input
              id={`${ids}-email`}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-password`} className="text-base font-medium">
              {t("password")}
            </label>
            <input
              id={`${ids}-password`}
              type="text"
              autoComplete="new-password"
              value={password}
              aria-describedby={`${ids}-password-hint`}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <p id={`${ids}-password-hint`} className="text-text-muted text-sm">
              {t("passwordHint", { min: MIN_LENGTH })}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-locale`} className="text-base font-medium">
              {t("language")}
            </label>
            <select
              id={`${ids}-locale`}
              value={locale}
              onChange={(e) => setLocale(e.target.value === "en" ? "en" : "el")}
              className={inputClass}
            >
              <option value="el">{t("greek")}</option>
              <option value="en">{t("english")}</option>
            </select>
          </div>
          {problem ? (
            <p role="alert" className="bg-danger-soft text-text rounded-sm p-4 text-base font-medium">
              {problem}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="secondary" size="lg" icon={UserPlus} loading={add.isPending}>
              {t("add")}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
