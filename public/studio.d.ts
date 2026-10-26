export function createStudio(io: { attention?: (text: string) => boolean; send: (msg: object) => void; host: () => Element | null; say: (text: string) => Element | void }): {
  open(): void;
  handle(msg: Record<string, any>): boolean;
  enabled(): boolean;
};
