export interface ProblemInfo {
  line: string;
  where: string;
  details: string;
  count: number;
}

export interface ProblemReport {
  source: string;
  message: string;
  where: string;
  stack: string;
  count: number;
}

export function whereFrom(stack: unknown): string;

export function createErrorReporter<H = unknown>(options: {
  show: (info: ProblemInfo, handle: H | null) => H;
  send: (report: ProblemReport) => void;
  now?: () => number;
  later?: (fn: () => void, ms: number) => unknown;
}): {
  report(source: string, error: unknown): void;
  readonly distinct: number;
};

export function installErrorReporting(
  target: { addEventListener(type: string, listener: (e: any) => void): void },
  reporter: { report(source: string, error: unknown): void },
): void;
