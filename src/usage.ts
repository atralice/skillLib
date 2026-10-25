import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { claudeDir, readJson, skilllibHome } from "./paths.js";

export type UsageSource = "invoked" | "slash" | "file read";

export type SkillUse = { skill: string; source: UsageSource; cwd: string; at: string; key: string };

// Built-in Claude Code commands, which aren't skills.
const BUILTIN_COMMANDS = new Set([
  "add-dir", "agents", "bug", "clear", "compact", "config", "context", "cost", "doctor", "exit", "export",
  "fast", "feedback", "goal", "help", "hooks", "ide", "init", "install-github-app", "login", "logout", "mcp",
  "memory", "model", "output-style", "permissions", "plugin", "pr-comments", "privacy-settings", "release-notes",
  "resume", "rewind", "status", "statusline", "terminal-setup", "todos", "upgrade", "usage", "vim",
]);

/** Skill folder name for a path inside some `.claude/skills/<name>/` or `.agents/skills/<name>/`, if any. */
function skillNameFromPath(filePath: string): string | null {
  const match = filePath.replace(/\\/g, "/").match(/\/\.(?:claude|agents)\/skills\/([^/]+)\//);
  return match ? match[1]! : null;
}

type TranscriptLine = {
  type?: string;
  uuid?: string;
  cwd?: string;
  timestamp?: string;
  message?: { content?: unknown };
};

/** Skill uses in one line of a Claude Code transcript (~/.claude/projects/<project>/<session>.jsonl). */
export function usesFromTranscriptLine(line: string): SkillUse[] {
  if (!line.includes('"Skill"') && !line.includes("<command-name>") && !line.includes("/skills/")) return [];
  let record: TranscriptLine;
  try {
    record = JSON.parse(line) as TranscriptLine;
  } catch {
    return [];
  }
  const cwd = record.cwd ?? "";
  const at = record.timestamp ?? "";
  const content = record.message?.content;

  if (record.type === "assistant" && Array.isArray(content)) {
    return content.flatMap((block): SkillUse[] => {
      if (!block || typeof block !== "object" || block.type !== "tool_use") return [];
      const key = String(block.id);
      if (block.name === "Skill" && typeof block.input?.skill === "string") {
        return [{ skill: block.input.skill, source: "invoked", cwd, at, key }];
      }
      if (block.name === "Read" && typeof block.input?.file_path === "string") {
        const skill = skillNameFromPath(block.input.file_path);
        return skill ? [{ skill, source: "file read", cwd, at, key }] : [];
      }
      return [];
    });
  }

  if (record.type === "user" && typeof content === "string") {
    const match = content.match(/<command-name>\/?([\w.:-]+)<\/command-name>/);
    if (!match || BUILTIN_COMMANDS.has(match[1]!)) return [];
    return [{ skill: match[1]!, source: "slash", cwd, at, key: record.uuid ?? `${at}:${match[1]}` }];
  }

  return [];
}

function transcriptFiles(sinceMs: number): string[] {
  const base = join(claudeDir(), "projects");
  if (!existsSync(base)) return [];
  // A folder that can't be read (root-owned after sudo) is skipped, as an unreadable transcript is.
  const list = (dir: string) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  return list(base).flatMap((project) => {
    const dir = join(base, project);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return []; // a link to nothing is skipped
    return list(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f))
      // Only plain files: a link that loops (ELOOP) or a FIFO named *.jsonl (reading it would hang) is skipped.
      .filter((f) => {
        try {
          const st = statSync(f);
          return st.isFile() && st.mtimeMs >= sinceMs;
        } catch {
          return false;
        }
      });
  });
}

type CachedFile = { size: number; mtimeMs: number; uses: SkillUse[] };
type UsageCache = { files: Record<string, CachedFile> };

function usageCacheFile(): string {
  return join(skilllibHome(), "usage-cache.json");
}

function readUsageCache(): UsageCache {
  const data = readJson<UsageCache>(usageCacheFile());
  return data?.files && typeof data.files === "object" ? data : { files: {} };
}

/** Writes the cache, or leaves the old one: a missed save only means the next scan reads the transcripts again. */
function writeUsageCache(cache: UsageCache) {
  const path = usageCacheFile();
  const temp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, JSON.stringify(cache));
    renameSync(temp, path);
  } catch {
    rmSync(temp, { force: true });
  }
}

async function usesIn(file: string): Promise<SkillUse[]> {
  const uses: SkillUse[] = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) uses.push(...usesFromTranscriptLine(line));
  return uses;
}

/** Every skill use recorded in Claude Code transcripts over the last `days` days. */
export async function scanUsage(days: number): Promise<SkillUse[]> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = transcriptFiles(sinceMs);
  const cache = readUsageCache();
  let dirty = false;
  // A transcript that's gone doesn't stay in the cache. Ones outside this window stay, for a longer --days.
  for (const file of Object.keys(cache.files)) {
    if (!files.includes(file) && !existsSync(file)) {
      delete cache.files[file];
      dirty = true;
    }
  }
  const seen = new Map<string, SkillUse>();
  for (const file of files) {
    // One transcript that can't be read (root-owned after sudo, deleted mid-scan) is skipped, not the whole count.
    try {
      const st = statSync(file);
      // Whole milliseconds: JSON keeps those exactly, so a saved entry still matches next time.
      const mtimeMs = Math.round(st.mtimeMs);
      const hit = cache.files[file];
      const uses = hit && hit.size === st.size && hit.mtimeMs === mtimeMs && Array.isArray(hit.uses) ? hit.uses : await usesIn(file);
      if (uses !== hit?.uses) {
        cache.files[file] = { size: st.size, mtimeMs, uses };
        dirty = true;
      }
      for (const use of uses) if (Date.parse(use.at) >= sinceMs) seen.set(use.key, use);
    } catch {
      continue;
    }
  }
  if (dirty) writeUsageCache(cache);
  return [...seen.values()];
}

export type UsageSummary = { skill: string; uses: number; lastUsed: string; projects: Set<string> };

/** The skill a use counts for: a plugin's copy (/plugin:name) counts for its name. */
export const skillOf = (key: string) => key.split(":").pop()!;

/** Uses grouped by skill. `projectOf` maps a session's cwd to a project root (or null). */
export function summarize(uses: SkillUse[], projectOf: (cwd: string) => string | null = () => null): UsageSummary[] {
  const bySkill = new Map<string, UsageSummary>();
  for (const use of uses) {
    // A plugin's copy (/plugin:name) counts for the skill, so moving it out of the plugin keeps its history.
    const skill = skillOf(use.skill);
    const summary = bySkill.get(skill) ?? { skill, uses: 0, lastUsed: "", projects: new Set<string>() };
    summary.uses += 1;
    if (use.at > summary.lastUsed) summary.lastUsed = use.at;
    const project = projectOf(use.cwd);
    if (project) summary.projects.add(project);
    bySkill.set(skill, summary);
  }
  return [...bySkill.values()].sort((a, b) => b.uses - a.uses);
}

/** Uses per project root, per skill name as used. `projectOf` maps a session's cwd to a project root (or null). */
export function usesByProject(uses: SkillUse[], projectOf: (cwd: string) => string | null): Map<string, Map<string, number>> {
  const byProject = new Map<string, Map<string, number>>();
  for (const use of uses) {
    const root = projectOf(use.cwd);
    if (!root) continue;
    const counts = byProject.get(root) ?? new Map<string, number>();
    // As summarize: a plugin's copy (/plugin:name) counts for the skill, so status and doctor agree.
    const skill = skillOf(use.skill);
    counts.set(skill, (counts.get(skill) ?? 0) + 1);
    byProject.set(root, counts);
  }
  return byProject;
}
