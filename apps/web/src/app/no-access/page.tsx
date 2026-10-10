import { FriendlyError } from "@/features/errors/FriendlyError";

/** Signed in, but the role may not use the app (E2-5: say so instead of a 404). */
export default function NoAccessPage() {
  return <FriendlyError kind="forbidden" />;
}
