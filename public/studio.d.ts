export function createStudio(io: { send: (msg: object) => void; host: () => Element | null; say: (text: string) => void }): {
  open(): void;
  handle(msg: Record<string, any>): boolean;
  enabled(): boolean;
};
