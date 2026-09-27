import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { claudeDir } from "./paths.js";

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
export function skillNameFromPath(filePath: string): string | null {
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
  return readdirSync(base).flatMap((project) => {
    const dir = join(base, project);
    if (!statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f))
      .filter((f) => statSync(f).mtimeMs >= sinceMs);
  });
}

/** Every skill use recorded in Claude Code transcripts over the last `days` days. */
export async function scanUsage(days: number): Promise<SkillUse[]> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const seen = new Map<string, SkillUse>();
  for (const file of transcriptFiles(sinceMs)) {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      for (const use of usesFromTranscriptLine(line)) {
        if (Date.parse(use.at) >= sinceMs) seen.set(use.key, use);
      }
    }
  }
  return [...seen.values()];
}

export type UsageSummary = { skill: string; uses: number; lastUsed: string; projects: Set<string> };

/** Uses grouped by skill. `projectOf` maps a session's cwd to a project root (or null). */
export function summarize(uses: SkillUse[], projectOf: (cwd: string) => string | null = () => null): UsageSummary[] {
  const bySkill = new Map<string, UsageSummary>();
  for (const use of uses) {
    const summary = bySkill.get(use.skill) ?? { skill: use.skill, uses: 0, lastUsed: "", projects: new Set<string>() };
    summary.uses += 1;
    if (use.at > summary.lastUsed) summary.lastUsed = use.at;
    const project = projectOf(use.cwd);
    if (project) summary.projects.add(project);
    bySkill.set(use.skill, summary);
  }
  return [...bySkill.values()].sort((a, b) => b.uses - a.uses);
}
