import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const t = await getTranslations("login");
  return (
    <main className="ops-login-main">
      <Suspense fallback={<p className="ops-muted">{t("loading")}</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
