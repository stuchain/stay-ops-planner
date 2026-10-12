import type { Mutation } from "@tanstack/react-query";
import { readClientError } from "./errors";

/**
 * Whether a failed save still needs a message: it has no `onError` of its own and is not marked
 * `meta: { handlesErrors: true }` (it shows the error itself, e.g. from `mutateAsync` in a try/catch).
 * An expired session is left to the sign-in dialog.
 */
export function needsFallbackMessage(
  mutation: Pick<Mutation<unknown, unknown, unknown, unknown>, "options" | "meta">,
  error: unknown,
): boolean {
  if (mutation.options.onError) return false;
  if (mutation.meta?.handlesErrors === true) return false;
  return readClientError(error).code !== "UNAUTHORIZED";
}
