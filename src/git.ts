import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ALL_PROJECT_DIRS } from "./harnesses.js";
import { MANIFEST_FILE } from "./paths.js";

/**
 * Whether a skill folder is shared through git:
 * - committed: tracked and unchanged, so teammates get it
 * - changed:   tracked, with uncommitted edits or new files
 * - new:       not tracked yet, but not ignored (shows in `git status`)
 * - ignored:   matched by .gitignore, so it only exists on this machine
 */
export type GitState = "committed" | "changed" | "new" | "ignored";

export type GitInfo = {
  /** Git state per path relative to the project root (e.g. ".agents/skills/foo"). */
  of: (relPath: string) => GitState;
};

function git(root: string, args: string[], input?: string): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf-8", input, stdio: ["pipe", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    // check-ignore exits 1 when nothing is ignored; that's still a valid answer.
    const out = (err as { stdout?: string }).stdout;
    return typeof out === "string" ? out : null;
  }
}

/** Git state of every skill folder in a project, or null when it isn't a git repo. */
export function gitInfo(root: string): GitInfo | null {
  if (!existsSync(join(root, ".git"))) return null;
  const dirs = [...ALL_PROJECT_DIRS, MANIFEST_FILE].filter((d) => existsSync(join(root, d)));
  if (dirs.length === 0) return { of: () => "new" };

  const tracked = (git(root, ["ls-files", "-z", "--", ...dirs]) ?? "").split("\0").filter(Boolean);
  const dirty = (git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...dirs]) ?? "")
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));

  const ignoredCache = new Map<string, boolean>();
  const isIgnored = (rel: string) => {
    if (!ignoredCache.has(rel)) {
      const out = git(root, ["check-ignore", "--no-index", "--", rel]) ?? "";
      ignoredCache.set(rel, out.trim().length > 0);
    }
    return ignoredCache.get(rel)!;
  };

  const under = (list: string[], rel: string) => list.some((p) => p === rel || p.startsWith(rel + "/"));
  return {
    of: (relPath: string) => {
      const rel = relPath.replace(/\/+$/, "");
      if (under(tracked, rel)) return under(dirty, rel) ? "changed" : "committed";
      return isIgnored(rel) ? "ignored" : "new";
    },
  };
}

export function relativeTo(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}
