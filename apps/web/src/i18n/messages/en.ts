/** English UI strings (default). */
export const en = {
  nav: {
    calendar: "Calendar",
    cleaning: "Cleaning",
    bookings: "Bookings",
    excel: "Excel",
    settings: "Settings",
  },
  calendar: {
    title: "Calendar",
    /** Stable for automation; visible only to AT. */
    selectMonthAria: "Select month",
    today: "Today",
    display: "Display",
    displayMonthCount: "Display month count",
    month1: "1 month",
    month2: "2 months",
    month3: "3 months",
    filters: "Filters",
    unassignedList: "Unassigned list",
    needsAssignment: "Needs assignment",
    allAssigned: "All bookings are assigned for this month.",
    filtersSoon: "Filters are coming soon.",
    assignedOk: "Booking assigned successfully.",
    assignFail: "Failed to assign booking.",
  },
  bookings: {
    title: "Bookings",
  },
  settings: {
    title: "Settings",
    language: "Interface language",
    languageHelp: "Applies to navigation and key labels after reload.",
    saveLanguage: "Save language",
    languageSaved: "Language updated.",
    languageError: "Could not save language preference.",
  },
} as const;

type DeepString<T> = T extends string ? string : { readonly [K in keyof T]: DeepString<T[K]> };

/** Same nested keys as `en`, but leaf values are `string` so locales can use translated copy. */
export type MessageTree = DeepString<typeof en>;
