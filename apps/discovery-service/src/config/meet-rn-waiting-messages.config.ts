/**
 * Subtext messages shown on the "Meet RN" waiting screen
 * (after the user accepts and is waiting for the other person).
 */
export const MEET_RN_WAITING_MESSAGES = [
  "Maybe they fainted, you're that hot!",
  "They're probably refreshing their vibe check...",
  "Plot twist: they're typing the perfect opener.",
  "Your aura is buffering their decision.",
  "Somewhere, someone is practicing their hello.",
  "They're speed-running courage right now.",
  "Give them a sec — greatness takes a moment.",
  "They're consulting the universe. You're the answer."
] as const;

export type MeetRnWaitingMessage = (typeof MEET_RN_WAITING_MESSAGES)[number];
