export const SUGGESTION_REASON_CODE_LABELS = {
  ROOM_AVAILABLE: "Room is free for the full booking window.",
  ROOM_BLOCKED: "Room overlaps with an assignment or maintenance block.",
  ROOM_CAPACITY_EXCEEDED: "Party size exceeds this room’s max guests.",
  CLEANING_WINDOW_FITS: "Cleaning turnover window is feasible before check-in.",
  CLEANING_DOES_NOT_FIT: "Cleaning turnover window is too tight before check-in.",
  TIE_BREAK_ROOM_CODE: "Tie resolved by deterministic room code order.",
} as const;

export type SuggestionReasonCode = keyof typeof SUGGESTION_REASON_CODE_LABELS;

export type SuggestionScoreBreakdown = {
  availability: number;
  cleaningFit: number;
  tieBreaker: number;
};

export type SuggestionResponseItem = {
  roomId: string;
  score: number;
  reasonCodes: SuggestionReasonCode[];
  breakdown: SuggestionScoreBreakdown;
};
