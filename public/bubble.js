/** The words of a reply as the speech bubble shows them: Markdown marks taken off, nothing else changed. */
export function bubbleText(text) {
  return text
    .replace(/```[\s\S]*?```/g, " (a code block) ")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)[^)\s]+\)/g, "$1") // a link is just its words: the chat has the link
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/^\s{0,3}(?:#{1,6}|>)\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** How long a finished reply's bubble stays up, in milliseconds. */
export const BUBBLE_LINGER_MS = 20000;
