export const GREETING: string;
export const PACK_INTRO: string;
export const DRAWN_AGAIN: string;
export function reply(input: string, context?: { presets?: string[]; pack?: boolean; model?: boolean; recent?: string[]; basic?: boolean }): { text: string; scene?: string; needsModel?: boolean };
export function basicGreeting(name?: string): string;
