export function speechText(text: string): string;
export function takeSentences(text: string): { ready: string; rest: string };
export function createVoice(onSpeaking: (speaking: boolean) => void): {
  readonly supported: boolean;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  speak(text: string): void;
  cancel(): void;
};
