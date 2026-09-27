import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { skilllibHome, userHome } from "./paths.js";

/** Everything an agent needs to judge one skill. */
export type ReviewSkill = {
  name: string;
  description: string;
  /** Plain-language origin, e.g. "Claude Code plugin ponytail@ponytail (vendor-managed)". */
  source: string;
  /** How it got onto this machine, e.g. "`npx skills add dietrichgebert/ponytail`". */
  installedHow: string;
  path: string;
  links: string[];
  /** Harness names that load it, and where ("every repo" / "in deferred"). */
  loadedBy: string;
  /** Vendor skills can't be deleted from their folder; say how to turn them off instead. */
  vendor: string | null;
  usesTotal: number | null;
  usesByProject: [project: string, uses: number][];
  installedIn: string[];
  otherCopies: string[];
  inYourSkills: string | null;
  /** You marked it as global on purpose. */
  keptGlobal?: boolean;
};

export type ReviewContext = {
  scope: string;
  usageDays: number;
  harnesses: string[];
  projects: { name: string; path: string }[];
};

const EXCERPT_CHARS = 1200;

function tildify(p: string): string {
  const home = userHome();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

/** First part of SKILL.md (frontmatter included), plus the file count, so the agent can judge quality. */
function skillExcerpt(dir: string, chars: number): { text: string; files: number; size: number } {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return { text: "(SKILL.md not found)", files: 0, size: 0 };
  // Drop the frontmatter: name and description are already listed above.
  const content = readFileSync(file, "utf-8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let files = 0;
  try {
    files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
  } catch {
    files = 1;
  }
  return { text: content.length > chars ? content.slice(0, chars) + "\n…(truncated)" : content, files, size: content.length };
}

/** A self-contained prompt asking an agent to recommend keep / move / delete for each skill. */
export function buildReviewPrompt(skills: ReviewSkill[], ctx: ReviewContext): string {
  const many = skills.length > 1;
  // Long lists get shorter excerpts; the agent can open the files for more.
  const excerptChars = many ? Math.max(300, Math.floor(12000 / skills.length)) : EXCERPT_CHARS * 3;
  const sections = skills.map((s, i) => {
    const ex = skillExcerpt(s.path, excerptChars);
    const usage =
      s.usesTotal === null
        ? "unknown (usage not loaded)"
        : s.usesTotal === 0
          ? `not used in the last ${ctx.usageDays} days`
          : `${s.usesTotal} use${s.usesTotal === 1 ? "" : "s"} in the last ${ctx.usageDays} days${s.usesByProject.length ? ` (${s.usesByProject.map(([p, n]) => `${p}: ${n}`).join(", ")})` : ""}`;
    return [
      `### ${many ? `${i + 1}. ` : ""}${s.name}`,
      `- Description: ${s.description || "(none)"}`,
      `- Source: ${s.source}`,
      `- Installed via: ${s.installedHow}`,
      `- Location: ${tildify(s.path)}${s.links.length ? ` (also linked from ${s.links.map(tildify).join(", ")})` : ""}`,
      `- Loaded by: ${s.loadedBy}`,
      ...(s.vendor ? [`- Vendor-managed: ${s.vendor}`] : []),
      ...(s.keptGlobal ? ["- I marked this as global on purpose: recommend changing that only for a strong reason (unused, duplicated, low quality)"] : []),
      `- Usage (Claude Code transcripts only): ${usage}`,
      `- Installed in projects: ${s.installedIn.length ? s.installedIn.join(", ") : "none"}`,
      `- Other copies agents can see: ${s.otherCopies.length ? s.otherCopies.join("; ") : "none"}`,
      `- In Your skills (skilllib library): ${s.inYourSkills ?? "no"}`,
      `- Size: ${ex.files} file${ex.files === 1 ? "" : "s"}, SKILL.md ${ex.size} chars`,
      "",
      "SKILL.md body (excerpt):",
      "```markdown",
      ex.text.trim(),
      "```",
    ].join("\n");
  });

  return `You are reviewing Claude Code / agent skills installed on my machine to decide which ones to keep. ${ctx.scope}

## Background
- A skill is a folder with a SKILL.md. Every loaded skill's name and description sit in the agent's context in every session, so each one costs context and can trigger when it shouldn't.
- "Global" skills load in EVERY repo for the listed agents. Project skills only load inside that repo.
- I use these agents: ${ctx.harnesses.join(", ") || "(none configured)"}.
- I manage skills with skilllib, which can: keep a skill global; move it into specific projects (and out of global); delete it (a backup is kept); or leave vendor skills alone. Vendor skills (plugins, claude.ai, Cursor built-ins) can only be turned off at their source.
- Usage counts only cover Claude Code sessions over the last ${ctx.usageDays} days; other agents' usage isn't tracked, so treat "unused" as a strong hint, not proof.

## My projects
${ctx.projects.map((p) => `- ${p.name} — ${tildify(p.path)}`).join("\n") || "(none)"}

You can open the paths above (skills and projects) to check what a skill does and what each project uses (package.json, README, tech stack).

## Skills to review
${sections.join("\n\n")}

## What I want back
For each skill, recommend exactly one of:
- **keep global**: genuinely useful in almost every repo
- **move to projects**: only relevant to some; name them from my project list
- **delete**: unused, redundant, low quality, or superseded by another copy
- **vendor: turn off at source**: say how (e.g. /plugin in Claude Code)

Weigh usage, relevance to my projects' stacks, duplicates (prefer one copy), overlap with other skills, and quality/staleness of the SKILL.md. Be decisive; say when you're unsure.

Reply with a short table (skill · decision · projects · one-line reason), then this JSON so I can apply it:

\`\`\`json
[{ "skill": "name", "decision": "keep-global | move | delete | vendor-off", "projects": ["project-name"], "reason": "…" }]
\`\`\`
`;
}

/** Copies text to the system clipboard; also saves it to ~/.skilllib/review-prompt.md. */
export function copyText(text: string): { copied: boolean; savedTo: string } {
  const savedTo = join(skilllibHome(), "review-prompt.md");
  mkdirSync(skilllibHome(), { recursive: true });
  writeFileSync(savedTo, text);
  const tools: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];
  for (const [cmd, args] of tools) {
    const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (r.status === 0) return { copied: true, savedTo };
  }
  return { copied: false, savedTo };
}

