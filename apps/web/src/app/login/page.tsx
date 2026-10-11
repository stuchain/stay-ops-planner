import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import "@/ui/theme.css";

export default async function LoginPage() {
  const t = await getTranslations("login");
  return (
    <div data-ui="new" className="flex min-h-screen items-center justify-center p-6">
      <main className="w-full max-w-md">
        <Suspense fallback={<p className="text-text-muted text-base">{t("loading")}</p>}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
