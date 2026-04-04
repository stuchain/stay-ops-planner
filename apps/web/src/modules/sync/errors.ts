export type SyncApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function syncJsonError(code: string, message: string, details?: unknown): SyncApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      details: details ?? undefined,
    },
  };
}
