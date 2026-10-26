export function createAttention(doc: { title: string; hidden: boolean }): {
  setName(name: string): void;
  notify(text: string): boolean;
  clear(): void;
};
