/** The short tour shown once on a first start and by `/welcome`: what is here, and the one command for each thing. Plain text, because it goes out as a notice. */
export interface WelcomeFacts {
  /** The brain's name, or null when none is installed (the built-in script answers). */
  brain: string | null;
  /** Where the documentation lives. */
  docs: string;
}

export function welcomeText(facts: WelcomeFacts): string {
  return [
    "Welcome! A short tour (type /welcome to see it again):",
    "",
    facts.brain
      ? `• Talk to her: just type. Her brain is ${facts.brain}. She can change her own look when you ask ("mint green hair", "glasses and a witch hat").`
      : `• Talk to her: no brain is installed yet, so only a small script answers (it can change her look, show moods and wave). Install one of Claude Code, Cursor, opencode or Ollama: ${facts.docs}brains.html`,
    "• Her looks: Looks… has presets, your saved looks and picture packs (outfits and things she does with you, like dancing, swimming or tennis). /frames lists the packs.",
    "• Work with her: the Work tab lets her read and edit a project folder. She asks before every command and file change.",
    "• Make her a new outfit: /studio on opens the pack studio. It draws with an image maker you choose in its list: a model on your computer, a paid API with your own key, or a website you are signed in to. With none of those, /studio handover gives you a prompt for any AI agent.",
    "• From your phone: /phone shows the link.",
    "• /help lists every command, and /doctor checks what is missing.",
    `• Everything is explained here: ${facts.docs}`,
  ].join("\n");
}
