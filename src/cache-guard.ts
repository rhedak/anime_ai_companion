/**
 * Claude Code keeps the conversation in a prompt cache so that each message only pays for what is new.
 * The cache lives about an hour (measured on real sessions: gaps under 60 minutes stayed warm, longer
 * ones went cold), after which the next message sends the whole conversation again at full price.
 * For a small conversation that is nothing; for a long one it can be a large share of the usage limit.
 */

/** A little under the hour, so a message sent right at the edge is not counted as warm. */
export const CACHE_LIFETIME_MS = 55 * 60_000;

/** Below this the re-read is cheap enough that a warning would only be noise. */
export const LARGE_CONTEXT_TOKENS = 100_000;

export interface ConversationState {
  /** Tokens sent with her last request, i.e. what the next message has to carry. */
  contextTokens: number | null;
  /** When she last finished a reply (ms since epoch). */
  lastReplyAt: number | null;
}

export interface ColdCache {
  tokens: number;
  idleMinutes: number;
}

/** The cost of the next message if its cache has gone cold and the conversation is big, otherwise null. */
export function coldCache(state: ConversationState, now = Date.now()): ColdCache | null {
  const { contextTokens, lastReplyAt } = state;
  if (contextTokens === null || lastReplyAt === null) return null;
  if (contextTokens < LARGE_CONTEXT_TOKENS) return null;
  const idle = now - lastReplyAt;
  if (idle < CACHE_LIFETIME_MS) return null;
  return { tokens: contextTokens, idleMinutes: Math.round(idle / 60_000) };
}

export function formatIdle(minutes: number): string {
  if (minutes < 120) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
}

/** Tokens as "354k" for the warning. */
export const formatTokens = (tokens: number): string => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens));

/**
 * Where Claude Code starts compacting, as `--autocompact` wants it: "auto" (a share of the model's whole
 * window, which is 1M tokens on current models) or a size between 100k and 1M. Left alone, a conversation
 * could grow to roughly 950k tokens, and every restart or idle hour makes the next message pay for all of it.
 */
export const DEFAULT_AUTOCOMPACT = "200000";

export function parseAutocompact(value: string | undefined): string {
  const text = value?.trim().toLowerCase();
  if (!text) return DEFAULT_AUTOCOMPACT;
  if (text === "auto") return "auto";
  const match = /^(\d+)(k?)$/.exec(text);
  if (!match) return DEFAULT_AUTOCOMPACT;
  const tokens = Number(match[1]) * (match[2] ? 1000 : 1);
  return tokens >= 100_000 && tokens <= 1_000_000 ? String(tokens) : DEFAULT_AUTOCOMPACT;
}
