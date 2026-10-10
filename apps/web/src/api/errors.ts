import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { isDomainErrorCode, type DomainErrorCode, type DomainErrorParams } from "@stay-ops/domain";

export type ClientErrorCode = DomainErrorCode | "NETWORK";
export type ClientError = { code: ClientErrorCode; params: DomainErrorParams };

/** The error code and params from any thrown value; a failed fetch is NETWORK. */
export function readClientError(error: unknown): ClientError {
  if (error instanceof TRPCClientError) {
    const domain = (error.data as { domain?: { code?: unknown; params?: DomainErrorParams } } | undefined)?.domain;
    if (domain && isDomainErrorCode(domain.code)) return { code: domain.code, params: domain.params ?? {} };
    return { code: error.data ? "INTERNAL" : "NETWORK", params: {} };
  }
  return { code: "INTERNAL", params: {} };
}

/** Translates one code under `errors` in the messages. */
export type ErrorTranslator = (code: ClientErrorCode, params: Record<string, string | number>) => string;

/** The sentence for an error from the messages. Never the server's message. */
export function translateError(error: unknown, translate: ErrorTranslator): string {
  const { code, params } = readClientError(error);
  // Messages may name a guest or apartment; a missing one reads as empty, never as "{guestName}".
  return translate(code, { guestName: "", roomName: "", ...params });
}

/** `(error) => sentence` in the user's language. */
export function useErrorText(): (error: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((error: unknown) => translateError(error, (code, params) => t(code, params)), [t]);
}
