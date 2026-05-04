import type { MessageTree } from "./en";

/** Greek UI strings. */
export const el: MessageTree = {
  nav: {
    calendar: "Ημερολόγιο",
    cleaning: "Καθαρισμός",
    bookings: "Κρατήσεις",
    excel: "Excel",
    settings: "Ρυθμίσεις",
  },
  calendar: {
    title: "Ημερολόγιο",
    selectMonthAria: "Επιλογή μήνα",
    today: "Σήμερα",
    display: "Εμφάνιση",
    displayMonthCount: "Αριθμός μηνών",
    month1: "1 μήνας",
    month2: "2 μήνες",
    month3: "3 μήνες",
    filters: "Φίλτρα",
    unassignedList: "Μη ανατεθειμένες",
    needsAssignment: "Χρειάζεται ανάθεση",
    allAssigned: "Όλες οι κρατήσεις είναι ανατεθειμένες για αυτόν τον μήνα.",
    filtersSoon: "Τα φίλτρα έρχονται σύντομα.",
    assignedOk: "Η κράτηση ανατέθηκε επιτυχώς.",
    assignFail: "Αποτυχία ανάθεσης κράτησης.",
  },
  bookings: {
    title: "Κρατήσεις",
  },
  settings: {
    title: "Ρυθμίσεις",
    language: "Γλώσσα περιβάλλοντος",
    languageHelp: "Ισχύει για το μενού και βασικά κείμενα μετά την αποθήκευση.",
    saveLanguage: "Αποθήκευση γλώσσας",
    languageSaved: "Η γλώσσα ενημερώθηκε.",
    languageError: "Δεν ήταν δυνατή η αποθήκευση της γλώσσας.",
  },
};
