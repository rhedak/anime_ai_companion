export function dictationProblem(code: string): string | null;
export function joinDictation(before: string, spoken: string): string;
export function dictationVendor(userAgent?: string): string;
export interface Dictation {
  readonly supported: boolean;
  readonly needsBrowser: boolean;
  readonly listening: boolean;
  readonly consented: boolean;
  consent(): void;
  toggle(): void;
  start(): void;
  stop(): void;
}
export function createDictation(options: {
  onText: (text: string, final: boolean) => void;
  onState: (listening: boolean) => void;
  onProblem: (message: string) => void;
  language?: () => string;
  env?: any;
}): Dictation;
