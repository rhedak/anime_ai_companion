import { join } from "node:path";
import type { Mode } from "./providers/types.ts";
import type { Broadcast, Say } from "./server-types.ts";
import { countSkills, reachedForUnloadedSkill, skillsNotice, userSkillsDir } from "./skills.ts";

/** What the skills switch needs from the server around it. */
export interface SkillsDeps {
  /** "claude", "ollama", … */
  brain(): string;
  canUseTools(): boolean;
  busy(): boolean;
  mode(): Mode;
  /** The whole Claude Code setup is on (which already includes the skills). */
  setup(): boolean;
  /** The folder she works in, or her chat folder. */
  folder(): string;
  /** Why a setting cannot change right now, or null. */
  cannotChange(): string | null;
  /** Restart the brain with the current settings; the conversation carries on. */
  reconfigure(): void;
  /** A note for the model, sent with its next message. */
  pushNote(text: string): void;
  broadcast: Broadcast;
  modeInfo(): unknown;
  /** Her name, for the question. */
  name(): string;
  remoteRefusal(): string;
}

/**
 * Letting her use the user's own skills by name (`/skills`, the checkbox): the switch, the one-line notice about skills she cannot
 * use yet, and the question when she reaches for one that is not loaded. The rules (what it loads, what it leaves off) are in
 * skills.ts and the safety notes of AGENTS.md.
 */
export function createSkillsService(deps: SkillsDeps) {
  /** The switch. Never saved: it loads the user's own settings (without their hooks), so each start begins without. */
  let on = false;
  /** Folders already told about, so the notice comes once per folder and run. */
  const noticed = new Set<string>();
  /** Asked once per conversation: a "no" is not asked again until she is cleared or the setting changes. */
  let offered = false;
  /** The user said yes while she was mid-reply: apply it when the reply ends. */
  let pending = false;

  function change(want: boolean, say: Say): void {
    const blocked = deps.cannotChange();
    if (blocked) say(blocked);
    else if (deps.brain() !== "claude") say("Skills are a Claude Code feature.");
    else if (!deps.canUseTools()) say("This model cannot use tools, so there are no skills to load.");
    else {
      on = want;
      offered = false;
      deps.reconfigure(); // restarts claude; the conversation carries on
      // She only hears about it with the next message: the running conversation keeps its first prompt.
      deps.pushNote(
        want
          ? "the user turned your skills on: the Skill tool now finds their own skills by name, so use it instead of reading skill files by hand."
          : "the user turned your skills off again: the Skill tool no longer finds their own skills.",
      );
      say(
        want
          ? "Her skills are on in work mode: she can use your own skills (~/.claude/skills) by name. Your user settings apply too, but their hooks stay off."
          : "Her skills are off again.",
      );
    }
    deps.broadcast(deps.modeInfo());
  }

  async function offer(): Promise<void> {
    if (offered || on || deps.setup() || deps.mode() !== "work" || deps.brain() !== "claude") return;
    if ((await countSkills(userSkillsDir())) === 0) return;
    offered = true;
    deps.broadcast({ type: "skills-offer", name: deps.name() });
  }

  return {
    enabled: () => on,

    change,

    /** The /skills command. */
    command(args: string, say: Say, remote: boolean): void {
      const wanted = args.toLowerCase();
      if (wanted === "on" && remote) return say(deps.remoteRefusal());
      if (wanted === "on" || wanted === "off") return change(wanted === "on", say);
      say(`Her skills are ${on ? "on" : "off"} in work mode. Use /skills on | off`);
    },

    /** A line about skills she cannot use yet, once per folder and run. */
    async maybeNotice(say: Say): Promise<void> {
      if (deps.brain() !== "claude" || deps.mode() !== "work" || deps.setup()) return;
      const cwd = deps.folder();
      if (noticed.has(cwd)) return;
      noticed.add(cwd);
      const text = skillsNotice({ project: await countSkills(join(cwd, ".claude", "skills")), user: await countSkills(userSkillsDir()) }, { skills: on, setup: deps.setup() });
      if (text) say(text);
    },

    /** Did a tool call just show she reached for a skill that is not loaded? If so, ask. */
    noticeToolUse(tool: { name: string; summary: string; status: string }): void {
      if (reachedForUnloadedSkill(tool, userSkillsDir())) void offer();
    },

    /** The answer to the question. */
    answer(choice: unknown, remote: boolean, say: Say): void {
      if (choice !== "load" && choice !== "no") return;
      if (choice === "load" && remote) return say(deps.remoteRefusal());
      deps.broadcast({ type: "skills-resolved", choice });
      if (choice === "no") return;
      if (deps.busy()) {
        pending = true;
        return say("Loading her skills as soon as she has finished this reply.");
      }
      change(true, say);
    },

    /** A reply has ended: apply a "yes" that came while she was talking. */
    applyPending(): void {
      if (!pending) return;
      pending = false;
      change(true, (text) => deps.broadcast({ type: "notice", text }));
    },

    /** A new conversation may be asked again. */
    forgetOffer(): void {
      offered = false;
    },
  };
}
