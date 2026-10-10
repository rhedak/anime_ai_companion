import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];
export const isEffort = (value: unknown): value is Effort => efforts.includes(value as Effort);

/** The effort part of the user's own Claude Code settings (~/.claude/settings.json). Nothing else is read. */
export interface UserEffort {
  effortLevel: Effort | null;
  /** By model id, e.g. "claude-sonnet-5-5". */
  perModel: Record<string, Effort>;
}

export async function loadUserEffort(): Promise<UserEffort> {
  const path = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
  try {
    return parseUserEffort(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return { effortLevel: null, perModel: {} };
  }
}

export function parseUserEffort(settings: any): UserEffort {
  const perModel: Record<string, Effort> = {};
  for (const [id, value] of Object.entries(settings?.modelSettings ?? {})) {
    const level = (value as any)?.effortLevel;
    if (isEffort(level)) perModel[id] = level;
  }
  return { effortLevel: isEffort(settings?.effortLevel) ? settings.effortLevel : null, perModel };
}

/**
 * The effort Claude Code would use in the terminal for this model: a per-model setting if there is
 * one, otherwise the general one. `model` is an alias ("sonnet") or a full id; an alias means the newest
 * model of that family that has a setting.
 */
export function resolveEffort(user: UserEffort, model: string): Effort | null {
  if (user.perModel[model]) return user.perModel[model];
  const version = (id: string) => id.slice(`claude-${model}-`.length).split("-").map(Number);
  const newest = Object.keys(user.perModel)
    .filter((id) => id.startsWith(`claude-${model}-`))
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    })[0];
  return newest ? user.perModel[newest] : user.effortLevel;
}
