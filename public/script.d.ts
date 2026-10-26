export const GREETING: string;
export const PACK_INTRO: string;
export const DRAWN_AGAIN: string;
export function reply(input: string, context?: { presets?: string[]; pack?: boolean; character?: string; model?: boolean; recent?: string[]; basic?: boolean; body?: string | null }): { text: string; scene?: string; needsModel?: boolean };
export function basicGreeting(name?: string): string;
export function packIntroFor(character?: string): string;
export function personaFor(character?: string): string;
