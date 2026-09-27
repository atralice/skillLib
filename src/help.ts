/**
 * In-app help. Harness facts come from each tool's docs (checked September 2026):
 * - Claude Code: https://code.claude.com/docs/en/skills
 * - Cursor:      https://cursor.com/docs/context/skills
 * - Codex:       https://learn.chatgpt.com/docs/build-skills
 * - Zed:         https://zed.dev/docs/ai/skills
 */
export type HelpTopic = { id: string; title: string; icon?: string; blocks: HelpBlock[] };
export type HelpBlock = { heading?: string; lines: string[] };

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "basics",
    title: "Using skilllib",
    blocks: [
      {
        lines: [
          "Pick a place on the left: a project, Your skills, Global, Health or Settings. Its skills show on the right.",
          "Inside a project, tab switches between Usable here and Add skills.",
        ],
      },
      {
        heading: "Keys",
        lines: [
          "type          search the pane you're in",
          "↑ ↓           move          → ←   open / close a group",
          "space         the main action: add, remove, copy, clean up, restore",
          "enter         every action for the selected row (or open a place)",
          "tab           switch lists inside a project",
          "esc           clear the search, then go back to the left pane",
          "ctrl+r        reload        ctrl+c   quit",
          "p             in the cleanup wizard: copy a prompt asking an agent to review the skills",
        ],
      },
      {
        heading: "Badges",
        lines: [
          "✻ ⬡ ◎ ℤ       Claude Code, Cursor, Codex, Zed — lit when that agent loads the skill here",
          "²             Cursor reaches it through two folders (it reads several)",
          "⚠ loaded globally   loads in every repo on this machine",
          "⧉ N copies    the same skill reaches agents from N places — keep one",
          "● in sync · ↑ update · ✎ edited · ○ only here",
          "✓ committed   in git, so teammates get it      ± changed   committed, with local edits",
          "+ not added   not committed yet                ∅ ignored   gitignored — only on your machine",
        ],
      },
    ],
  },
  {
    id: "sources",
    title: "Where skills come from",
    blocks: [
      {
        lines: ["A skill is a folder with a SKILL.md. Agents only ever read folders — these are all the places they can be:"],
      },
      {
        heading: "In a repo (only agents working in that repo see them)",
        lines: [
          ".claude/skills   Claude Code (Cursor reads it too). skilllib installs here when you use Claude Code.",
          ".agents/skills   the shared folder: Codex, Cursor, Zed and most other agents. Repos often commit their team skills here.",
          "                 skilllib installs here when you don't use Claude Code, and links here for Codex and Zed when you do.",
          ".cursor/skills   Cursor only.     .codex/skills   Cursor only (compatibility).",
        ],
      },
      {
        heading: "Global (every repo on this machine — every agent reads them all the time)",
        lines: [
          "~/.claude/skills   Claude Code and Cursor. Things you or tools copied in.",
          "~/.agents/skills   Codex, Cursor, Zed. `npx skills add` installs here (and links into ~/.claude/skills).",
          "~/.cursor/skills   Cursor only.",
        ],
      },
      {
        heading: "From vendors (skilllib can't remove these — manage them at the source)",
        lines: [
          "Claude Code plugins      /plugin; skills are namespaced, e.g. /ponytail:ponytail",
          "claude.ai skills         synced from your account to ~/.claude/skills/synced (/anthropic-skills:name)",
          "Claude Code bundled      built-in commands like /code-review",
          "Cursor built-in          ~/.cursor/skills-cursor, updates with Cursor",
          "Cursor plugins           installed from Cursor's marketplace (skilllib doesn't list these yet)",
          "Codex system skills      bundled by OpenAI; /etc/codex/skills for admin-installed ones",
        ],
      },
      {
        heading: "Your skills (skilllib)",
        lines: [
          "~/.skilllib/library holds one master copy of each skill you saved. Nothing there loads by itself —",
          "a project gets a copy (pinned to a version in skilllib.json) when you add it.",
        ],
      },
    ],
  },
  {
    id: "claude-code",
    title: "Claude Code",
    icon: "✻",
    blocks: [
      {
        heading: "Where it looks (winner first when names collide)",
        lines: [
          "1 Enterprise   managed settings folder (org-deployed)",
          "2 Personal     ~/.claude/skills — every project",
          "3 Project      .claude/skills in the repo",
          "4 Nested       <subfolder>/.claude/skills — sessions working in that folder",
          "5 Plugin       <plugin>/skills — namespaced as /plugin:skill",
          "6 Bundled      built-ins like /code-review",
          "Also: skills synced from claude.ai (~/.claude/skills/synced), and folders added with --add-dir.",
          "It does NOT read .agents/skills — link a skill into .claude/skills for Claude to see it.",
        ],
      },
      {
        heading: "How it uses them",
        lines: [
          "Every skill's description is always in context; the full SKILL.md loads when you type /name",
          "or when Claude decides it matches the task.",
          "disable-model-invocation: true → only you can run it.   user-invocable: false → only Claude can.",
        ],
      },
      {
        heading: "Per-repo control",
        lines: [
          'skillOverrides in .claude/settings(.local).json: "off", "name-only", "user-invocable-only".',
          "It's Claude-only, so skilllib moves skills out of global instead of blocking them.",
        ],
      },
    ],
  },
  {
    id: "cursor",
    title: "Cursor",
    icon: "⬡",
    blocks: [
      {
        heading: "Where it looks",
        lines: [
          "Project   .agents/skills, .cursor/skills — nested folders too (scoped to files inside them)",
          "User      ~/.agents/skills, ~/.cursor/skills",
          "Compat    .claude/skills, .codex/skills, ~/.claude/skills, ~/.codex/skills",
          "Plus      plugins from its marketplace, and Cursor's built-in skills",
          "Cloud Agents only see ~/.cursor/skills.",
          "Its docs don't say what happens when two folders hold the same skill (the ² badge).",
        ],
      },
      {
        heading: "How it uses them",
        lines: [
          "Descriptions decide relevance; full content loads on use. Type / to run one.",
          "paths: [globs] in frontmatter limits a skill to matching files.",
          "disable-model-invocation: true makes it a manual slash command.",
          "No per-project switch for global skills.",
        ],
      },
    ],
  },
  {
    id: "codex",
    title: "Codex",
    icon: "◎",
    blocks: [
      {
        heading: "Where it looks",
        lines: [
          "Repo     .agents/skills in the working folder, its parents, and the repo root",
          "User     ~/.agents/skills",
          "Admin    /etc/codex/skills",
          "System   skills bundled by OpenAI",
          "It does NOT read .claude/skills — skilllib puts your skills in .agents/skills (a link, if you also use Claude Code).",
        ],
      },
      {
        heading: "How it uses them",
        lines: [
          "Starts with names and descriptions (capped at ~2% of context), loads SKILL.md when used.",
          "Type $ to pick one; it also chooses them itself when the description matches.",
          "Same-name skills aren't merged — both can show up.",
          "agents/openai.yaml → policy.allow_implicit_invocation: false keeps it manual.",
          "Disable one everywhere: [[skills.config]] path = …, enabled = false in ~/.codex/config.toml.",
        ],
      },
    ],
  },
  {
    id: "zed",
    title: "Zed",
    icon: "ℤ",
    blocks: [
      {
        heading: "Where it looks",
        lines: [
          "Project  <worktree>/.agents/skills — only in trusted worktrees",
          "Global   ~/.agents/skills",
          "Only direct children count (no nested skill folders).",
          "When names collide, the project's skill wins.",
        ],
      },
      {
        heading: "How it uses them",
        lines: [
          "The agent sees a catalog (name + description) and loads a skill when it matches.",
          "Type / or @skill to run one. Changes apply immediately — no restart.",
          "disable-model-invocation: true keeps it manual.",
        ],
      },
    ],
  },
];
