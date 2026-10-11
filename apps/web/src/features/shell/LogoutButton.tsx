"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { clearOfflineCache } from "@/api/offlineCache";
import { Button } from "@/ui/Button";

/** Signs out through the existing endpoint, then goes to the login page (a full load, so nothing stays cached). */
export function LogoutButton() {
  const t = useTranslations("session");
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    // The kept copy of the bookings goes first, so it is gone even if the request fails.
    clearOfflineCache();
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Even if the request fails, leaving for the login page is the safe thing to do.
    }
    window.location.assign("/login");
  }
  return (
    <Button
      variant="ghost"
      icon={LogOut}
      loading={busy}
      loadingLabel={t("loggingOut")}
      onClick={() => void logout()}
      className="w-full justify-start"
    >
      {t("logout")}
    </Button>
  );
}
