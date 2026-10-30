export function createStudio(io: { attention?: (text: string) => boolean; send: (msg: object) => void; host: () => Element | null; say: (text: string) => Element | void; closeWindow?: () => void }): {
  open(): void;
  isOpen(): boolean;
  handle(msg: Record<string, any>): boolean;
  enabled(): boolean;
};
