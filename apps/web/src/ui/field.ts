/**
 * The one text box look. `fieldClass` is the default for forms the owner fills in (56 px, 2 px border);
 * `compactFieldClass` is the same box at 44 px for table rows, toolbars and the Dev screens. Neither sets a
 * width, so add one (`w-full`, `w-56`) without a clash; `cn` does not merge conflicting classes.
 */
export const fieldClass =
  "min-h-button rounded-sm border-2 border-border bg-surface px-4 py-2 text-base text-text " +
  "placeholder:text-text-muted";

export const compactFieldClass =
  "min-h-target rounded-sm border-2 border-border bg-surface px-3 py-1 text-base text-text placeholder:text-text-muted";

/** A compact select with room for the chevron drawn over its right end. */
export const compactSelectClass = `${compactFieldClass} appearance-none pr-10 font-semibold`;
