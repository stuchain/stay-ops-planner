import { TRPCClientError } from "@trpc/client";
import { isDomainErrorCode, type DomainErrorCode, type DomainErrorParams } from "@stay-ops/domain";
import { errorsEl } from "@/i18n/errors.el";
import { errorsEn } from "@/i18n/errors.en";

export type ClientError = { code: DomainErrorCode | "NETWORK"; params: DomainErrorParams };

/** The error code and params from any thrown value; a failed fetch is NETWORK. */
export function readClientError(error: unknown): ClientError {
  if (error instanceof TRPCClientError) {
    const domain = (error.data as { domain?: { code?: unknown; params?: DomainErrorParams } } | undefined)?.domain;
    if (domain && isDomainErrorCode(domain.code)) return { code: domain.code, params: domain.params ?? {} };
    return { code: error.data ? "INTERNAL" : "NETWORK", params: {} };
  }
  return { code: "INTERNAL", params: {} };
}

/** The sentence to show for an error, in the user's language. Never the server's message. */
export function errorText(error: unknown, locale: "el" | "en" = "el"): string {
  const { code, params } = readClientError(error);
  const template = (locale === "el" ? errorsEl : errorsEn)[code];
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ""));
}
