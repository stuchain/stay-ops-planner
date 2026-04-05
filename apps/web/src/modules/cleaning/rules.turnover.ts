/**
 * Web module boundary for Phase 5 turnover math; canonical implementation lives in `@stay-ops/db`.
 * Default turnover window on the checkout calendar day at `CLEANING_DEFAULT_START_HOUR` (UTC placeholder).
 */
export { computeTurnoverPlannedWindowUTC, turnoverSourceEventId } from "@stay-ops/db";
