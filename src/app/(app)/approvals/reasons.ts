/**
 * Rejection reason codes offered in the review UI. Values must stay in sync
 * with the `reasonCode` enum in `ApprovalDecisionSchema` — they're the signal
 * the Insights dashboard groups rejections by.
 */
export const REJECTION_REASONS = [
  { value: "scope_too_broad", label: "Scope too broad" },
  { value: "scope_too_narrow", label: "Scope too narrow" },
  { value: "inaccurate_content", label: "Inaccurate content" },
  { value: "wrong_sequencing", label: "Wrong sequencing" },
  { value: "estimates_unrealistic", label: "Estimates unrealistic" },
  { value: "tone_inappropriate", label: "Tone inappropriate" },
  { value: "other", label: "Other" },
] as const;
