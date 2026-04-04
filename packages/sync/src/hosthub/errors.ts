export type HosthubClientErrorCode =
  | "HOSTHUB_AUTH_FAILED"
  | "HOSTHUB_RATE_LIMIT"
  | "HOSTHUB_HTTP_ERROR"
  | "HOSTHUB_PARSE_ERROR"
  | "HOSTHUB_NETWORK_ERROR"
  | "HOSTHUB_RETRY_EXHAUSTED";

export type HosthubClientError = {
  readonly code: HosthubClientErrorCode;
  readonly message: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
};

export function hosthubError(
  code: HosthubClientErrorCode,
  message: string,
  extra?: { statusCode?: number; cause?: unknown },
): HosthubClientError {
  return {
    code,
    message,
    statusCode: extra?.statusCode,
    cause: extra?.cause,
  };
}

export function isRetryableHosthubError(err: HosthubClientError): boolean {
  return (
    err.code === "HOSTHUB_RATE_LIMIT" ||
    err.code === "HOSTHUB_HTTP_ERROR" ||
    err.code === "HOSTHUB_NETWORK_ERROR"
  );
}

/** Maps HTTP status before body parse; 401 never retries. */
export function errorFromHttpStatus(status: number, statusText: string): HosthubClientError | null {
  if (status === 401) {
    return hosthubError("HOSTHUB_AUTH_FAILED", `Hosthub authentication failed (${status})`, {
      statusCode: status,
    });
  }
  if (status === 429) {
    return hosthubError("HOSTHUB_RATE_LIMIT", `Hosthub rate limited (${status})`, {
      statusCode: status,
    });
  }
  if (status >= 500) {
    return hosthubError("HOSTHUB_HTTP_ERROR", `Hosthub server error: ${status} ${statusText}`, {
      statusCode: status,
    });
  }
  if (status >= 400) {
    return hosthubError("HOSTHUB_HTTP_ERROR", `Hosthub client error: ${status} ${statusText}`, {
      statusCode: status,
    });
  }
  return null;
}
