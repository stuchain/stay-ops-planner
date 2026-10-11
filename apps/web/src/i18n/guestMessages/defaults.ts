/** Guest message templates (P4-10): the kinds, the languages and the built-in texts. */

export const MESSAGE_KINDS = ["welcome", "directions", "wifi", "checkin"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_LANGUAGES = ["el", "en"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

/** What can be written between braces in a template. */
export const PLACEHOLDERS = ["guest", "checkin", "checkout", "apartment", "nights", "people"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** A text someone saved, for all apartments (`roomId` null) or for one. */
export type TemplateOverride = {
  kind: MessageKind;
  lang: MessageLanguage;
  roomId: string | null;
  text: string;
};

/**
 * The texts used until Stelios saves his own. Anything in [square brackets] is for him to fill in:
 * the Wi-Fi name, the address and so on are not known to the app.
 */
export const DEFAULT_TEMPLATES: Record<MessageKind, Record<MessageLanguage, string>> = {
  welcome: {
    el: [
      "Καλησπέρα {guest}!",
      "Σας ευχαριστούμε για την κράτηση. Σας περιμένουμε από {checkin} έως {checkout} ({nights}).",
      "Διαμέρισμα: {apartment}",
      "Αν χρειαστείτε οτιδήποτε, γράψτε μας εδώ.",
    ].join("\n"),
    en: [
      "Hello {guest}!",
      "Thank you for your booking. We look forward to welcoming you from {checkin} to {checkout} ({nights}).",
      "Apartment: {apartment}",
      "If you need anything, just message us here.",
    ].join("\n"),
  },
  directions: {
    el: [
      "Καλησπέρα {guest}! Οδηγίες για να φτάσετε:",
      "Διεύθυνση: [διεύθυνση]",
      "Χάρτης: [σύνδεσμος Google Maps]",
      "Διαμέρισμα: {apartment}",
      "Αν δυσκολευτείτε να μας βρείτε, τηλεφωνήστε μας: [τηλέφωνο]",
    ].join("\n"),
    en: [
      "Hello {guest}! Here is how to find us:",
      "Address: [address]",
      "Map: [Google Maps link]",
      "Apartment: {apartment}",
      "If you have trouble finding us, call us: [phone number]",
    ].join("\n"),
  },
  wifi: {
    el: [
      "Καλησπέρα {guest}! Το Wi-Fi του διαμερίσματος:",
      "Δίκτυο: [όνομα δικτύου]",
      "Κωδικός: [κωδικός]",
      "Καλή διαμονή!",
    ].join("\n"),
    en: [
      "Hello {guest}! The Wi-Fi in the apartment:",
      "Network: [network name]",
      "Password: [password]",
      "Enjoy your stay!",
    ].join("\n"),
  },
  checkin: {
    el: [
      "Καλησπέρα {guest}! Η άφιξή σας είναι στις {checkin}.",
      "Το check-in γίνεται από τις [ώρα]. Πώς θα μπείτε: [οδηγίες εισόδου, κωδικός ή κλειδί].",
      "Διαμέρισμα: {apartment}",
      "Η αναχώρηση είναι στις {checkout} μέχρι τις [ώρα].",
      "Καλή διαμονή!",
    ].join("\n"),
    en: [
      "Hello {guest}! You arrive on {checkin}.",
      "Check-in is from [time]. How to get in: [entry instructions, code or key].",
      "Apartment: {apartment}",
      "Check-out is on {checkout} by [time].",
      "Enjoy your stay!",
    ].join("\n"),
  },
};
