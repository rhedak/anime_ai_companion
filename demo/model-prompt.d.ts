export const MODEL: { title: string; idF16: string; idF32: string; downloadMB: number; licence: string; library: string };
export function modelId(hasF16: boolean): string;
export function systemPrompt(emotions: string[], name?: string, kind?: string, persona?: string): string;
export function buildMessages(history: { type: string; text: string }[], emotions: string[], name?: string, turns?: number, kind?: string, persona?: string): { role: string; content: string }[];
export function guessEmotion(text: string, emotions: string[]): string;
export function emotionFix(answer: string, emotions: string[]): string;
