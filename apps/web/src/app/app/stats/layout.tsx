import { requireAppPolicy } from "@/modules/auth/appAuth";

/** Money screens: never for read-only family accounts. */
export default async function MoneyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAppPolicy("money");
  return children;
}
