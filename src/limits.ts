// Ported from the work repo (lib/systemone.mjs, lib/agent.mjs).
// These limits are tested in production there. Do not tune them here without a reason.

/** A decision model rates at most 24 candidates in one choice question. More answers HTTP 400. */
export const MAX_OPTIONS = 24;
/** Each part of a long menu is one more question. A longer menu is faster with the planner. */
export const MAX_MENU_PARTS = 2;
/** Escape option that lets the model reject a menu part. */
export const OTHER = "other";
/** Long labels, such as a consent checkbox with two links, cost context without helping the choice. */
export const LABEL_CHARS = 90;

/** No-change steps before the planner takes over. */
export const STUCK_ESCALATE = 2;
/** No-change steps before the run pauses for a human. */
export const STUCK_PAUSE = 4;
/** Recent steps that count for repeat detection. */
export const REPEAT_WINDOW = 10;
/** Repeats in the window before the planner takes over. */
export const REPEAT_ESCALATE = 3;
/** Repeats in the window before the run pauses. */
export const REPEAT_PAUSE = 5;
/** Planner answers in a row that run nothing, before the run pauses. */
export const IDLE_ANSWERS_PAUSE = 3;
/** Steps between two planner verify calls. */
export const VERIFY_COOLDOWN_STEPS = 3;

// New defaults for this repo. They are config, not tested constants.
export const CONFIDENCE_THRESHOLD = 0.7;
export const DONE_PROBABILITY = 0.9;
/** Recent actions the reflex state shows. */
export const HISTORY_FOR_REFLEX = 3;
export const REFLEX_LINE_CHARS = 100;
export const REFLEX_CONTEXT_TOKENS = 8192;
/** Starting guess. One token is about 1.7 characters on the work app's pages. */
export const CHARS_PER_TOKEN = 1.6;
export const CONTEXT_MARGIN = 0.9;
export const MIN_OUTLINE_CHARS = 300;
/** Hard stop for the bootstrap loop, so a run cannot spin forever. */
export const MAX_STEPS = 12;
