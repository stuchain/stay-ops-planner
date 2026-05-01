export type SyncApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId: string;
  };
};

export function syncJsonError(
  code: string,
  message: string,
  details?: unknown,
  traceId = "",
): SyncApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      details: details ?? undefined,
      traceId,
    },
  };
}
