import { FriendlyError } from "@/features/errors/FriendlyError";

export default function NotFound() {
  return <FriendlyError kind="notFound" />;
}
