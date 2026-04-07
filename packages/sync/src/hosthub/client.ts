import { HosthubReservationPageSchema, type HosthubReservationPage } from "./types.dto.js";
import { normalizeHosthubReservationPagePayload } from "./normalize.js";
import {
  errorFromHttpStatus,
  hosthubError,
  isRetryableHosthubError,
  type HosthubClientError,
} from "./errors.js";

export const STAY_OPS_SYNC_USER_AGENT = "stay-ops-planner-sync/0.1";

export type HosthubClientResult<T> = { ok: true; value: T } | { ok: false; error: HosthubClientError };

export type HosthubClientOptions = {
  /** Base URL including API version path when required, e.g. https://app.hosthub.com/api/2019-03-01 */
  baseUrl: string;
  apiToken: string;
  /** List endpoint path (default `/calendar-events`). Override via HOSTHUB_API_RESERVATIONS_PATH. */
  listReservationsPath?: string;
  fetchFn?: typeof fetch;
  /** Default 30s */
  timeoutMs?: number;
  /** Retries for idempotent GET only; default 3 */
  maxRetries?: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs + Math.floor(Math.random() * 250);
  }
  const base = Math.min(8000, 500 * 2 ** attempt);
  return base + Math.floor(Math.random() * 400);
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const sec = Number.parseInt(header.trim(), 10);
  if (!Number.isFinite(sec) || sec < 0) return undefined;
  return sec * 1000;
}

/**
 * Safe observability hook: status, duration, optional request id from provider — never log tokens.
 */
export type HosthubRequestLog = (info: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId?: string;
}) => void;

function parseHosthubListResponse(body: unknown): HosthubClientResult<HosthubReservationPage> {
  const normalized = normalizeHosthubReservationPagePayload(body);
  if (!normalized) {
    return {
      ok: false,
      error: hosthubError(
        "HOSTHUB_PARSE_ERROR",
        "Unrecognized Hosthub list response shape; compare with https://www.hosthub.com/docs/api/",
      ),
    };
  }
  const parsed = HosthubReservationPageSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      error: hosthubError("HOSTHUB_PARSE_ERROR", "Hosthub list response failed validation", {
        cause: parsed.error,
      }),
    };
  }
  return { ok: true, value: parsed.data };
}

export class HosthubClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly listReservationsPath: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onRequest?: HosthubRequestLog;
  private readonly baseOrigin: string;
  private readonly basePathPrefix: string;

  constructor(options: HosthubClientOptions & { onRequest?: HosthubRequestLog }) {
    if (!options.baseUrl?.trim()) {
      throw new Error("HosthubClient requires baseUrl");
    }
    if (!options.apiToken?.trim()) {
      throw new Error("HosthubClient requires apiToken");
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl.trim());
    const parsedBase = new URL(this.baseUrl);
    this.baseOrigin = parsedBase.origin;
    this.basePathPrefix = parsedBase.pathname.replace(/\/+$/, "");
    this.apiToken = options.apiToken.trim();
    const path = options.listReservationsPath?.trim() || "/calendar-events";
    this.listReservationsPath = path.startsWith("/") ? path : `/${path}`;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.onRequest = options.onRequest;
  }

  /**
   * Resolve `navigation.next` or other request targets: absolute URL, or path relative to API base.
   */
  private resolveRequestUrl(nextPageUrl: string): string {
    const t = nextPageUrl.trim();
    if (t.startsWith("http://") || t.startsWith("https://")) {
      return t;
    }
    if (t.startsWith("?")) {
      const baseListPath = this.listReservationsPath.startsWith("/")
        ? `${this.basePathPrefix}${this.listReservationsPath}`
        : `${this.basePathPrefix}/${this.listReservationsPath}`;
      const u = new URL(baseListPath, this.baseOrigin);
      u.search = t;
      return u.toString();
    }
    if (t.startsWith("/")) {
      if (this.basePathPrefix && t.startsWith(`${this.basePathPrefix}/`)) {
        return new URL(t, this.baseOrigin).toString();
      }
      if (this.basePathPrefix && !t.startsWith("/api/")) {
        return new URL(`${this.basePathPrefix}${t}`, this.baseOrigin).toString();
      }
      return new URL(t, this.baseOrigin).toString();
    }
    return new URL(t, `${this.baseUrl}/`).toString();
  }

  private pathForLogFromUrl(fetchUrl: string): string {
    try {
      const u = new URL(fetchUrl);
      return u.pathname + u.search;
    } catch {
      return fetchUrl;
    }
  }

  /**
   * Idempotent GET: first page uses `updated_gte` (Unix); further pages use Hosthub `navigation.next` URL verbatim.
   */
  async listCalendarEventsPage(args: {
    nextPageUrl: string | null;
    updatedGte?: number | null;
  }): Promise<HosthubClientResult<HosthubReservationPage>> {
    let fetchUrl: string;
    let pathForLog: string;

    if (args.nextPageUrl) {
      fetchUrl = this.resolveRequestUrl(args.nextPageUrl);
      pathForLog = this.pathForLogFromUrl(fetchUrl);
    } else {
      const firstPath = this.listReservationsPath.startsWith("/")
        ? `${this.basePathPrefix}${this.listReservationsPath}`
        : `${this.basePathPrefix}/${this.listReservationsPath}`;
      const url = new URL(firstPath, this.baseOrigin);
      const gte = args.updatedGte;
      if (gte != null && Number.isFinite(gte)) {
        url.searchParams.set("updated_gte", String(Math.floor(gte)));
      }
      fetchUrl = url.toString();
      pathForLog = this.listReservationsPath + (url.search || "");
    }

    return this.getJson(fetchUrl, pathForLog, parseHosthubListResponse);
  }

  private async getJson<T>(
    url: string,
    pathForLog: string,
    parseBody: (body: unknown) => HosthubClientResult<T>,
  ): Promise<HosthubClientResult<T>> {
    let lastError: HosthubClientError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: this.apiToken,
            "User-Agent": STAY_OPS_SYNC_USER_AGENT,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        lastError = hosthubError("HOSTHUB_NETWORK_ERROR", "Hosthub request failed", { cause: e });
        if (attempt < this.maxRetries && isRetryableHosthubError(lastError)) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return { ok: false, error: lastError };
      }

      const durationMs = Date.now() - started;
      const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-correlation-id") ?? undefined;
      this.onRequest?.({
        method: "GET",
        path: pathForLog,
        status: res.status,
        durationMs,
        requestId,
      });

      if (res.status === 401) {
        return { ok: false, error: errorFromHttpStatus(401, res.statusText)! };
      }

      if (!res.ok) {
        const httpErr =
          errorFromHttpStatus(res.status, res.statusText) ??
          hosthubError("HOSTHUB_HTTP_ERROR", `Unexpected status ${res.status}`, { statusCode: res.status });
        if (
          attempt < this.maxRetries &&
          (res.status === 429 || res.status >= 500) &&
          isRetryableHosthubError(httpErr)
        ) {
          const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
          await sleep(backoffMs(attempt, retryAfter));
          lastError = httpErr;
          continue;
        }
        return { ok: false, error: httpErr };
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        return {
          ok: false,
          error: hosthubError("HOSTHUB_PARSE_ERROR", "Invalid JSON in Hosthub response", { cause: e }),
        };
      }

      return parseBody(body);
    }

    return {
      ok: false,
      error:
        lastError ??
        hosthubError("HOSTHUB_RETRY_EXHAUSTED", "Hosthub request retries exhausted", {
          statusCode: undefined,
        }),
    };
  }
}
