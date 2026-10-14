"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LockOpen, LogOut, Settings2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTRPC } from "@/api/client";
import { useErrorText } from "@/api/errors";
import type { RouterOutputs } from "@/api/types";
import { compactFieldClass } from "@/ui/field";
import { Button } from "@/ui/Button";
import { ErrorState } from "@/ui/ErrorState";
import { PageHeader } from "@/ui/PageHeader";
import { SidePanel } from "@/ui/SidePanel";
import { Skeleton } from "@/ui/Skeleton";
import { showToast } from "@/ui/Toast";

type UserRow = RouterOutputs["dev"]["users"]["list"]["users"][number];

const field = compactFieldClass;

function UserPanel({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const t = useTranslations("dev.users");
  const errorText = useErrorText();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  useEffect(() => {
    setPassword("");
    setConfirmSignOut(false);
  }, [user?.id]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.dev.users.list.queryKey() });
  const onError = (error: unknown) => showToast({ message: errorText(error), tone: "danger" });

  const setPasswordMutation = useMutation({
    ...trpc.dev.users.setPassword.mutationOptions(),
    onSuccess: () => {
      setPassword("");
      showToast({ message: t("passwordSaved"), tone: "success" });
    },
    onError,
  });
  const unlock = useMutation({
    ...trpc.dev.users.unlock.mutationOptions(),
    onSuccess: () => {
      refresh();
      showToast({ message: t("unlocked"), tone: "success" });
    },
    onError,
  });
  const signOut = useMutation({
    ...trpc.dev.users.signOutEverywhere.mutationOptions(),
    onSuccess: () => {
      setConfirmSignOut(false);
      showToast({ message: t("signedOut"), tone: "success" });
    },
    onError,
  });

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (user) setPasswordMutation.mutate({ userId: user.id, newPassword: password });
  }

  return (
    <SidePanel
      open={user !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={user?.email ?? ""}
      description={t("panelSubtitle")}
    >
      {user ? (
        <div className="flex flex-col gap-8">
          <form onSubmit={submitPassword} className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{t("newPassword")}</h3>
            <label className="flex flex-col gap-2">
              <span className="font-medium">{t("passwordLabel")}</span>
              <input
                type="text"
                autoComplete="off"
                className={field}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <span className="text-text-muted text-sm">{t("passwordHint")}</span>
            </label>
            <div>
              <Button type="submit" variant="primary" icon={KeyRound} loading={setPasswordMutation.isPending}>
                {t("savePassword")}
              </Button>
            </div>
          </form>

          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{t("signOutTitle")}</h3>
            <p className="text-text-muted">{t("signOutText")}</p>
            <div className="flex flex-wrap gap-3">
              {confirmSignOut ? (
                <>
                  <Button
                    variant="danger"
                    icon={LogOut}
                    loading={signOut.isPending}
                    onClick={() => signOut.mutate({ userId: user.id })}
                  >
                    {t("signOutConfirm")}
                  </Button>
                  <Button onClick={() => setConfirmSignOut(false)}>{t("cancel")}</Button>
                </>
              ) : (
                <Button icon={LogOut} onClick={() => setConfirmSignOut(true)}>
                  {t("signOut")}
                </Button>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{t("lockTitle")}</h3>
            <p className={user.lockedForSeconds === null ? "text-text-muted" : "text-warning-text font-medium"}>
              {user.lockedForSeconds === null
                ? t("notLocked")
                : t("lockedFor", { minutes: Math.max(1, Math.ceil(user.lockedForSeconds / 60)) })}
            </p>
            <div>
              <Button
                icon={LockOpen}
                disabled={user.lockedForSeconds === null}
                loading={unlock.isPending}
                onClick={() => unlock.mutate({ userId: user.id })}
              >
                {t("unlock")}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </SidePanel>
  );
}

/** Dev mode: the users, their sign-in state, and the admin tools for passwords, sign-outs and lockouts. */
export function UsersScreen() {
  const t = useTranslations("dev.users");
  const locale = useLocale() === "en" ? "en" : "el";
  const errorText = useErrorText();
  const trpc = useTRPC();
  const list = useQuery(trpc.dev.users.list.queryOptions());
  const [editingId, setEditingId] = useState<string | null>(null);

  const users = list.data?.users ?? [];
  const editing = users.find((u) => u.id === editingId) ?? null;
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "el" ? "el-GR" : "en-GB", {
        timeZone: "Europe/Athens",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  return (
    <div className="flex flex-col gap-6 p-8 phone:p-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {list.isPending ? (
        <Skeleton variant="block" className="h-48" />
      ) : list.error ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <div className="bg-surface shadow-card rounded-card overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="text-text-muted text-sm">
              <tr className="border-border border-b">
                <th className="px-4 py-3 font-semibold">{t("email")}</th>
                <th className="px-3 py-3 font-semibold">{t("role")}</th>
                <th className="px-3 py-3 font-semibold">{t("status")}</th>
                <th className="px-3 py-3 font-semibold">{t("language")}</th>
                <th className="px-3 py-3 font-semibold">{t("lastLogin")}</th>
                <th className="px-3 py-3 font-semibold">{t("signIn")}</th>
                <th className="py-3 pr-4">
                  <span className="sr-only">{t("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-border border-b">
                  <td className="px-4 py-3 font-medium break-all">{u.email}</td>
                  <td className="px-3 py-3">{t(`roles.${u.role}`)}</td>
                  <td className="px-3 py-3">{u.isActive ? t("active") : t("inactive")}</td>
                  <td className="px-3 py-3">{t(`languages.${u.locale}`)}</td>
                  <td className="px-3 py-3 text-sm whitespace-nowrap">
                    {u.lastLoginAt ? dateFormat.format(new Date(u.lastLoginAt)) : t("never")}
                  </td>
                  <td className="px-3 py-3">
                    {u.lockedForSeconds === null ? (
                      t("open")
                    ) : (
                      <span className="text-warning-text font-medium">{t("locked")}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <Button icon={Settings2} onClick={() => setEditingId(u.id)}>
                      {t("manage")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UserPanel user={editing} onClose={() => setEditingId(null)} />
    </div>
  );
}
