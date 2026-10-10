import type { DomainErrorCode } from "@stay-ops/domain";

/** Greek text for every error code. `{name}` is filled from the error's params. */
export const errorsEl: Record<DomainErrorCode | "NETWORK", string> = {
  UNAUTHORIZED: "Η σύνδεση έληξε. Συνδεθείτε ξανά.",
  FORBIDDEN: "Δεν έχετε δικαίωμα για αυτή την ενέργεια.",
  NOT_FOUND: "Δεν βρέθηκε. Ίσως διαγράφηκε.",
  VALIDATION: "Κάτι δεν συμπληρώθηκε σωστά. Ελέγξτε τα στοιχεία.",
  BOOKING_CHANGED: "Η κράτηση άλλαξε στο μεταξύ. Δείτε την ξανά και δοκιμάστε πάλι.",
  ROOM_TAKEN: "Το διαμέρισμα είναι πιασμένο από {guestName} αυτές τις ημέρες.",
  ROOM_CLOSED: "Το διαμέρισμα είναι κλειστό αυτές τις ημέρες.",
  ROOM_INACTIVE: "Αυτό το διαμέρισμα δεν είναι σε χρήση.",
  NOT_CONFIRMED: "Η κράτηση δεν έχει επιβεβαιωθεί ακόμα.",
  STAY_STARTED: "{guestName} μένει ήδη στο {roomName}. Να μετακινηθεί;",
  STAY_ENDED: "Η διαμονή έχει τελειώσει, οπότε δεν μετακινείται.",
  INVALID_STAY: "Η αναχώρηση πρέπει να είναι μετά την άφιξη.",
  HOSTHUB_DISCONNECTED: "Η σύνδεση με το Hosthub διακόπηκε. Ενημερώστε τον Στέλιο.",
  INTERNAL: "Κάτι πήγε στραβά. Δοκιμάστε ξανά.",
  NETWORK: "Δεν υπάρχει σύνδεση στο διαδίκτυο. Δοκιμάστε ξανά.",
};
