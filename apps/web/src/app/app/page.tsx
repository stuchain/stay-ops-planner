import { redirect } from "next/navigation";

/** Where a signed-in person lands: Today. */
export default function AppHomePage() {
  redirect("/app/today");
}
