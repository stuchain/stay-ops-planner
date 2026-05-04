"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageTree } from "./messages/en";
import { el } from "./messages/el";
import { getString, type LocaleCode } from "./lookup";

type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (next: LocaleCode) => void;
  t: (path: string) => string;
  refreshFromServer: () => Promise<void>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const trees: Record<LocaleCode, MessageTree> = { en, el };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>("en");

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next === "el" ? "el" : "en";
    }
  }, []);

  const refreshFromServer = useCallback(async () => {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return;
    const j = (await res.json()) as { data?: { user?: { uiLocale?: string } } };
    const raw = j.data?.user?.uiLocale;
    if (raw === "el" || raw === "en") setLocale(raw);
  }, [setLocale]);

  useEffect(() => {
    void refreshFromServer();
  }, [refreshFromServer]);

  useEffect(() => {
    document.documentElement.lang = locale === "el" ? "el" : "en";
  }, [locale]);

  const t = useCallback(
    (path: string) => {
      const fromLocale = getString(trees[locale], path);
      if (fromLocale) return fromLocale;
      const fallback = getString(trees.en, path);
      return fallback ?? path;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, refreshFromServer }),
    [locale, setLocale, t, refreshFromServer],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
