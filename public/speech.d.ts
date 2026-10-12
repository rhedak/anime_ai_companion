export function speechText(text: string): string;
export function takeSentences(text: string): { ready: string; rest: string };
export const RATES: number[];
export function cleanRate(value: unknown): number;
export function describeVoices(
  voices: { name: string; lang: string; voiceURI: string; localService?: boolean }[],
  language?: string,
): { uri: string; lang: string; local: boolean; label: string }[];
export function sampleText(lang: string): string;
export function createVoice(onSpeaking: (speaking: boolean) => void, onProblem?: (message: string) => void): {
  readonly supported: boolean;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  readonly rate: number;
  setRate(value: number): void;
  readonly voiceURI: string;
  setVoice(uri: string): void;
  voices(language?: string): { uri: string; lang: string; local: boolean; label: string }[];
  watchVoices(callback: () => void): void;
  speak(text: string): void;
  cancel(): void;
};
