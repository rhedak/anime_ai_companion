export type Span =
  | { type: "text" | "code"; text: string }
  | { type: "bold" | "italic"; children: Span[] }
  | { type: "link"; href: string; children: Span[] };
export type Block =
  | { type: "paragraph" | "quote"; lines: Span[][] }
  | { type: "heading"; level: number; children: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | { type: "code"; lang: string; text: string };
export function parseInline(text: string): Span[];
export function parseMarkdown(source: string): Block[];
export function renderMarkdown(source: string, container: Element, doc?: Document): void;
