import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

/** Where the user's own skills live. Claude Code reads them from here when the "user" settings source is on. */
export const userSkillsDir = () => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "skills");

/** How many skills a folder holds (subfolders with a SKILL.md); 0 when it does not exist. */
export async function countSkills(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => readdir(join(dir, e.name)).then((files) => files.includes("SKILL.md"), () => false)),
  );
  return found.filter(Boolean).length;
}

export interface SkillCounts {
  project: number;
  user: number;
}

/**
 * One line about skills she cannot use yet, or null when there is nothing to say. A folder's own skills
 * only load with the whole Claude Code setup (its hooks and MCP servers come with them); the user's own
 * skills have their own switch that leaves hooks off.
 */
export function skillsNotice(counts: SkillCounts, on: { skills: boolean; setup: boolean }): string | null {
  if (on.setup) return null;
  const plural = (n: number) => `${n} skill${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (counts.project > 0) {
    parts.push(
      `This folder has ${plural(counts.project)} of its own (.claude/skills). They stay off, because a folder's skills only load with ` +
        "/setup on, which also runs that folder's hooks and MCP servers.",
    );
  }
  if (counts.user > 0 && !on.skills) {
    parts.push(`You have ${plural(counts.user)} in ~/.claude/skills. /skills on lets her use them by name (your user settings apply; hooks stay off).`);
  }
  return parts.length ? parts.join(" ") : null;
}

/**
 * Did she just reach for a skill that is not loaded? Either the Skill tool failed, or she opened a skill's
 * SKILL.md among the user's own skills to read it by hand. A skill file in the project folder does not
 * count: turning on the user's skills would not help with it.
 */
export function reachedForUnloadedSkill(tool: { name: string; summary: string; status: string }, userDir: string): boolean {
  if (tool.name === "Skill") return tool.status === "error";
  if (tool.name !== "Read" || tool.status !== "running") return false;
  const wanted = `${userDir}${sep}`;
  return tool.summary.startsWith(wanted) && tool.summary.endsWith(`${sep}SKILL.md`);
}
