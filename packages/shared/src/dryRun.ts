/**
 * Dry-run contract (Epic 5): provably zero-write previews via transaction rollback.
 */

export type DryRunEntityType =
  | "booking"
  | "assignment"
  | "cleaning_task"
  | "room"
  | "source_listing"
  | "sync_run"
  | "import_error";

export type DryRunPlanAction = "create" | "update" | "delete" | "noop" | "upsert";

export type DryRunWarning = {
  code: string;
  message: string;
  details?: unknown;
};

export type DryRunPlanEntry = {
  index: number;
  entityType: DryRunEntityType;
  entityId?: string | null;
  action: DryRunPlanAction;
  before?: unknown;
  after?: unknown;
  warning?: string;
};

export type DryRunTotals = {
  processed: number;
  byAction: Record<string, number>;
  byEntity: Record<string, number>;
};

export type DryRunResult = {
  dryRun: true;
  totals: DryRunTotals;
  warnings: DryRunWarning[];
  entries: DryRunPlanEntry[];
  truncated: boolean;
};

const DRY_RUN_MESSAGE = "DRY_RUN_ROLLBACK";

/**
 * Thrown at the end of a transaction when `dryRun` is true so Prisma rolls back all writes.
 * The attached {@link DryRunResult} is the captured plan.
 */
export class DryRunRollback extends Error {
  readonly name = "DryRunRollback";

  constructor(public readonly plan: DryRunResult) {
    super(DRY_RUN_MESSAGE);
  }
}

export function isDryRunRollback(err: unknown): err is DryRunRollback {
  return err instanceof DryRunRollback;
}

const DEFAULT_MAX_ENTRIES = 200;

/**
 * Collects plan entries and warnings; {@link snapshot} builds a {@link DryRunResult}.
 */
export class PlanRecorder {
  private readonly entries: DryRunPlanEntry[] = [];
  private readonly warnings: DryRunWarning[] = [];
  private nextIndex = 0;
  private truncated = false;
  private readonly byActionCounts: Record<string, number> = {};
  private readonly byEntityCounts: Record<string, number> = {};

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  warning(w: DryRunWarning): void {
    this.warnings.push(w);
  }

  /**
   * Records one planned mutation. Increments processed totals even when entries are truncated from the list.
   */
  push(entry: Omit<DryRunPlanEntry, "index">): void {
    const action = entry.action;
    const entityType = entry.entityType;
    this.byActionCounts[action] = (this.byActionCounts[action] ?? 0) + 1;
    this.byEntityCounts[entityType] = (this.byEntityCounts[entityType] ?? 0) + 1;

    if (this.entries.length < this.maxEntries) {
      this.entries.push({ ...entry, index: this.nextIndex });
    } else {
      this.truncated = true;
    }
    this.nextIndex += 1;
  }

  snapshot(): DryRunResult {
    return {
      dryRun: true,
      totals: {
        processed: this.nextIndex,
        byAction: { ...this.byActionCounts },
        byEntity: { ...this.byEntityCounts },
      },
      warnings: [...this.warnings],
      entries: [...this.entries],
      truncated: this.truncated,
    };
  }
}

/**
 * Merges per-chunk dry-run results (e.g. one reconcile row at a time) into a single response.
 */
export function mergeDryRunResults(parts: DryRunResult[], maxEntries = DEFAULT_MAX_ENTRIES): DryRunResult {
  if (parts.length === 0) {
    return {
      dryRun: true,
      totals: { processed: 0, byAction: {}, byEntity: {} },
      warnings: [],
      entries: [],
      truncated: false,
    };
  }

  let processed = 0;
  const byAction: Record<string, number> = {};
  const byEntity: Record<string, number> = {};
  const warnings: DryRunWarning[] = [];
  const entries: DryRunPlanEntry[] = [];
  let truncated = false;
  let globalIndex = 0;

  for (const p of parts) {
    processed += p.totals.processed;
    for (const [k, v] of Object.entries(p.totals.byAction)) {
      byAction[k] = (byAction[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(p.totals.byEntity)) {
      byEntity[k] = (byEntity[k] ?? 0) + v;
    }
    warnings.push(...p.warnings);
    if (p.truncated) truncated = true;

    for (const e of p.entries) {
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      entries.push({ ...e, index: globalIndex });
      globalIndex += 1;
    }
    if (entries.length >= maxEntries) break;
  }

  return {
    dryRun: true,
    totals: { processed, byAction, byEntity },
    warnings,
    entries,
    truncated,
  };
}
