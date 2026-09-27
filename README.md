# skilllib

One library of agent skills, and each project gets only the skills it needs. It works with **Claude Code, Cursor, and Codex**. `skilllib` is a system-wide command: run it from any folder to open a full-screen, keyboard-driven app. Everything is local: there's no server, account, or database.

**Library vs. Global**

- **Library** (`~/.skilllib/library`) is your shelf of skills. Nothing in it loads anywhere until you add it to a project. Every change becomes a new version.
- **Global** is what your agents load in *every* project: `~/.claude/skills`, `~/.agents/skills`, plugins, claude.ai-synced skills, and Cursor's built-ins. Move yours into the library, then add them only where they're needed.

## Install

```bash
npm install -g skilllib
skilllib
```

Or try it without installing: `npx skilllib`.

It needs **Node.js 22 or newer** and runs on macOS and Linux. Windows support is newer: links are made as directory junctions, so no admin rights are needed, and CI runs the tests there. Everything stays on your machine; skilllib makes no network calls.

## First run

Run `skilllib`. It asks two things:

1. **Which agents you use.** Claude Code, Cursor, and Codex; installed ones are pre-selected.
2. **Where your projects live**, for example `~/Projects`. It finds every git repo there and rescans on each launch.

You can change both later in **Settings**, or with `skilllib harnesses` and `skilllib folders`.

## Where skills come from

A skill is a folder with a `SKILL.md`. Agents load skills from:

- **The repo:** `.claude/skills` (Claude Code and Cursor), `.agents/skills` (the shared folder for Codex, Cursor, Zed and others), `.cursor/skills`, and `.codex/skills`. Only agents working in that repo see these.
- **Global folders:** `~/.claude/skills`, `~/.agents/skills` (`npx skills add` installs here), and `~/.cursor/skills`. These load in every repo.
- **Vendors:** Claude Code plugins (`/plugin`), claude.ai skills synced from your account, Claude Code's bundled commands, Cursor's built-in and marketplace skills, and Codex system skills.
- **Your skills** (`~/.skilllib/library`): skilllib's master copies. Nothing there loads until you add it to a project.

The same content is in the app: press `?`, or open **Help** in the left pane.

### ✻ Claude Code ([docs](https://code.claude.com/docs/en/skills))

- **Where it looks.** When names collide, the first one listed wins: enterprise (managed settings) → `~/.claude/skills` → `.claude/skills` → nested `<subfolder>/.claude/skills` → plugins (namespaced as `/plugin:skill`) → bundled. It also loads claude.ai skills from `~/.claude/skills/synced` and folders added with `--add-dir`. It **does not** read `.agents/skills` (I tested this).
- **How it uses them.** Descriptions are always in context; the full `SKILL.md` loads on `/name` or when Claude decides it's relevant.
  - `disable-model-invocation: true`: only you can run it.
  - `user-invocable: false`: only Claude can run it.
- **Per-repo control.** `skillOverrides` in `.claude/settings.json`, with values `"off"`, `"name-only"` or `"user-invocable-only"`. This only affects Claude.

### ⬡ Cursor ([docs](https://cursor.com/docs/context/skills))

- **Where it looks.**
  - In the project: `.agents/skills` and `.cursor/skills`, including nested ones, which only apply to files inside them.
  - In your home folder: `~/.agents/skills` and `~/.cursor/skills`.
  - For compatibility: `.claude/skills`, `.codex/skills`, `~/.claude/skills` and `~/.codex/skills`.
  - It also loads marketplace plugins and its own built-ins. Cloud Agents only see `~/.cursor/skills`.
- **How it uses them.** Descriptions decide relevance, and the full content loads on use; `/` runs one. A `paths:` glob in the frontmatter limits a skill to matching files. `disable-model-invocation: true` makes it manual.
- **Limits.** There's no per-project switch for global skills. The docs don't say what happens when two folders hold the same skill.

### ◎ Codex ([docs](https://learn.chatgpt.com/docs/build-skills))

- **Where it looks.** `.agents/skills` in the working folder, its parents, and the repo root; then `~/.agents/skills`; `/etc/codex/skills` (admin); and OpenAI's bundled skills. It **does not** read `.claude/skills`.
- **How it uses them.** Names and descriptions come first (capped at about 2% of context); `SKILL.md` loads when used. Type `$` to pick one.
  - Skills with the same name aren't merged; both can appear.
  - To keep a skill manual, set `policy.allow_implicit_invocation: false` in `agents/openai.yaml`.
  - To disable a skill everywhere, add `[[skills.config]] … enabled = false` to `~/.codex/config.toml`.

### ℤ Zed ([docs](https://zed.dev/docs/ai/skills))

- **Where it looks.** `<worktree>/.agents/skills` (only in trusted worktrees) and `~/.agents/skills`. Only direct child folders count; nested skills aren't picked up. If both define the same name, the project's skill wins.
- **How it uses them.** The agent sees a catalog of names and descriptions; `/` or `@skill` runs one. Changes apply without a restart.

skilllib keeps one real copy of each skill and adds links so every agent you use can see it:

- **Claude Code and/or Cursor:** the copy goes in `.claude/skills`, which both of them read.
- **Codex too:** skilllib also adds a link in `.agents/skills`. If git tracks that folder (many repos commit their team skills there), skilllib asks first and remembers your answer for that project.

Every skill row shows which agents load it (`CC Cu Cx`: green means loaded, dim means not). **Make visible to…** adds any missing links. Switching agents never moves existing installs; the change only affects new ones.

Cursor doesn't document how it handles the same skill reached through two folders. When that happens, the row shows it in yellow.

## How it works

The left pane lists **places**: Library, Global, Health, your projects, and Settings. The right pane shows the skills in whichever place you pick. Usage over the last 30 days, read from Claude Code transcripts, appears as a column everywhere. For now it only counts Claude Code: Cursor keeps no transcripts on disk here, and Codex isn't installed on this machine to test against.

- **Type to search** in the pane you're in. Fuzzy matching works too: `cfw` finds `cloudflare-workers`.
- **Enter** opens a place (left pane) or shows every action for a skill (right pane).
- **Space** does the obvious thing: add, remove, import, fix, or restore.
- **Esc** clears the search, then returns to the left pane.
- **Tab** (inside a project) switches between Usable here and Add skills.
- **Ctrl+C** quits; **?** shows help.

### A project

A project has two lists. Press `tab` to switch between them:

- **Usable here:** everything agents see in this repo, grouped by where it comes from:
  - *From your skills*: versioned skills you added. Space removes one.
  - *The repo's own*: skills committed to the repo. Space copies one to **Your skills** so other repos can use it; the repo keeps its copy.
  - *⚠ Global · yours* ("loaded globally"): skills in `~/.claude/skills` or `~/.agents/skills` that load in every repo, so every agent reads them all the time. Space opens the cleanup wizard.
  - *Global · from vendors*, which only their vendor can remove:
    - **Claude Code plugins** you enabled (`/plugin`); only Claude loads these
    - **claude.ai skills** synced from your account; Claude only
    - **Cursor built-ins** that ship with Cursor; Cursor only

  Each skill in the repo also shows its **git state**:
  - **✓ committed**: in git, so teammates get it
  - **± changed**: committed, with uncommitted edits
  - **+ not added**: not committed yet
  - **∅ ignored**: matched by `.gitignore`, so it only exists on your machine. Many repos ignore `.claude/skills`.

  **⧉ N copies** means the same skill reaches agents from more than one place. For example, `ponytail` installed with `npx skills` *and* enabled as the `ponytail` plugin *and* added to the repo. The details panel lists every copy, so you can keep just one.
- **Add skills:** your skills that this repo doesn't have yet. Space adds one.

**Your skills** (`~/.skilllib/library`) keeps one master copy of each skill. That's what "Add skills" shows, what projects update from, and what gets restored when something is missing.

### Cleaning up global skills

Global skills can't be switched off for a single repo in Cursor or Codex. Claude Code has a per-project setting for it, but it only covers Claude. So instead of blocking them per repo, the **cleanup wizard** turns global skills into per-project ones:

1. For each global skill, choose what happens to it; Space cycles through the options:
   - **◉ move:** it goes into the projects you tick on the right. Projects that already have it, or where Claude Code used it, are pre-ticked.
   - **○ keep global**
   - **✕ delete** (`d` works too)

   Each skill shows how often Claude Code used it in the last 30 days, and the panel below shows its description and which projects used it.
2. Review, then apply. Moved skills are copied into Your skills and installed where you ticked. Deleted ones are **not** kept in Your skills. Either way the original stops loading globally and goes to a backup you can restore from Health.

### Ask an agent to review your skills

**Copy review prompt** puts a ready-to-paste prompt on your clipboard (it's also saved to `~/.skilllib/review-prompt.md`). Paste it into Claude Code, Cursor or Codex and the agent recommends **keep global / move to projects / delete / turn off at the vendor** for each skill, as a table plus JSON. For each skill the prompt includes:

- its description and an excerpt of the SKILL.md body
- how it was installed: vendor, plugin, skills.sh repo, claude.ai sync, or copied in
- its path and links
- which agents load it
- Claude Code usage per project
- which projects have it
- other copies
- whether it's in Your skills

It also lists your project paths, so the agent can check each project's stack.

Where to find it:
- **Global** → **✦ Ask an agent to review all global skills** (Enter lets you pick only your own)
- Enter on any skill or group → **Copy review prompt**
- `p` inside the cleanup wizard; then set move / keep / delete per skill based on the answer

To delete a single global skill without the wizard, use Enter → **Delete** in Global, or in a project's global section. **Delete all N** works on a whole group.

If a project can't take its copy (for example, the repo has a different skill with the same name), that skill stays global, so nothing loses it.

Related skills collapse into one row: skills from the same plugin (*ponytail plugin · 6 skills*), the same account or source (*claude.ai skills*, *Cursor built-in*, a skills.sh repo), or the same name prefix (`design-*`, `code-qa-*`). Space or `→` opens a group, `←` closes it, and Enter shows actions for the whole group, such as *Copy all into your library* or *Add all to this repo*. While you search, groups open up so every match is visible.

A line under the tabs says what the current list means. Search looks in the current tab, and tells you if the other tabs have matches.

If some skills in the repo aren't visible to every agent you use, the top of *Usable here* shows **⇄ Make all N skills usable by…**, which adds the missing links.

Each row shows which agents load it: **✻** Claude Code, **⬡** Cursor, **◎** Codex, **ℤ** Zed. An icon in brand color means that agent loads the skill; faint means it doesn't. `²` means Cursor reaches it through two folders.

### Adding and removing a skill

- **Space on an installable skill** copies its newest library version from `~/.skilllib/store` into `.claude/skills/<name>`. With Codex on, it also links it into `.agents/skills`. It records `{version, hash, links}` in `skilllib.json`. Agents pick it up in their next session.
- **Space on it again** deletes that project copy and its links, and drops the entry from `skilllib.json`. Your library copy and other projects aren't touched. If you edited the project copy, you're asked first; Enter → *Save local edits to the library* keeps them.
- **Adding it back** installs the newest version again.
- Skills skilllib didn't install (a repo's own skills) are never deleted by Space; it offers to copy them into your library instead.

### Repo skills in `.agents/skills`

Many repos commit their own skills to `.agents/skills`, the cross-agent folder that Codex, Cursor, Amp, and `npx skills` read. skilllib reads that folder as well as `.claude/skills`. Each skill shows which folder it lives in:

- `◉` means Claude Code can see the skill: it's in `.claude/skills`, or linked there.
- `◌` means only other agents can see it.

The repo owns these skills, so skilllib never moves them or adds them to `skilllib.json`:

- **Space** copies one into your library, so you can reuse it in other projects.
- **Enter → Link for Claude Code** adds a relative symlink in `.claude/skills` pointing at the repo copy. This is the same thing `npx skills` does, and `.claude/skills` is often gitignored. **Unlink** removes only the link.

Skills that skilllib installs from the library always go in `.claude/skills`.

### Versions: skills as dependencies

Every change to a library skill becomes a new version (v1, v2, …), stored immutably in `~/.skilllib/store`. A project's `skilllib.json` pins the version it uses:

```json
{ "skills": { "alpha": { "version": 2, "hash": "318bf4b94df4911c" } } }
```

| Command | Like | What it does |
|---|---|---|
| `skilllib sync` | `npm ci` | Installs exactly the pinned versions. It restores missing skills and never touches your edits. |
| `skilllib outdated` | `npm outdated` | Lists skills with a newer library version |
| `skilllib update [name]` | `npm update` | Moves to the newest version |
| Enter → *Install a specific version…* | `npm i x@1` | Pins any version, including older ones |

### Global and Health

- **Global:** everything Claude Code loads in *every* project. Your skills (`~/.claude/skills`, and skills.sh links) are listed separately from vendor skills (claude.ai, plugins). Space imports one of yours into the library, or stops it loading globally once it's there. Enter shows *import all* and *stop loading all*.
- **Health:** broken links, skills loaded twice, out-of-date projects, and repo-only skills, each with a one-key fix. Below them is everything skilllib moved out, which Space restores.

Nothing is ever deleted. Deleted skills go to `~/.skilllib/trash`, and unloaded global skills go to `~/.skilllib/global-backup`. Both can be restored from Health.

## Known limits

- **Cursor plugin skills aren't listed.** Cursor caches marketplace plugins in `~/.cursor/plugins/cache`, but it doesn't record which ones are enabled in any file skilllib can read. Listing them would guess.
- **Usage only counts Claude Code.**
- **Unloading a skills.sh skill doesn't update its lock file.** If you stop loading a skill from `~/.agents/skills`, the `npx skills` lock file still lists it as installed.

## Commands

Everything the app does is also available as a command, for scripts:

```
skilllib scan [folder...]       add project folders and scan them
skilllib folders [add|remove]   show or change project folders
skilllib import <dir>...        add skill folders to the library   (--global: ~/.claude/skills)
skilllib status                 this project's skills
skilllib add|remove <name>...   change this project's skills
skilllib sync [--all]           install exactly the pinned versions
skilllib outdated [--all]       skills with newer versions
skilllib update [name...]       move to the newest versions   (--all: every project)
skilllib list | show <name>     the library
skilllib new <name> [desc]      create a skill
skilllib projects               every project and its skills
skilllib usage [--days N]       what agents used
skilllib doctor [--fix]         problems, and fix them all
skilllib restore [name]         put back something that was moved out
skilllib unhide <path>          show a hidden project again
```

When output is piped, `skilllib` prints `skilllib status` instead of opening the app.

## Files

| Path | What |
|---|---|
| `~/.skilllib/library/<skill>/` | Your library. Consider putting it under git. |
| `~/.skilllib/config.json` | Project folders and hidden projects |
| `~/.skilllib/projects.json` | Projects found so far |
| `~/.skilllib/origins.json` | Where each library skill was imported from |
| `~/.skilllib/store/<skill>/<n>/` | Immutable copy of every version |
| `<project>/skilllib.json` | The project's skill dependencies and their pinned versions. Commit it with `.claude/skills/`. |

Set `SKILLLIB_HOME` to move `~/.skilllib`. `$VISUAL`/`$EDITOR` is used for editing. `CLAUDE_CONFIG_DIR` is honored.

## Development

```bash
pnpm install
pnpm test && pnpm type-check && pnpm build   # tests use bun
pnpm dev                                     # run from source
npm link                                     # use your checkout as the global `skilllib`
```

### Releasing

1. Bump `version` in `package.json` and merge to `main`.
2. Tag it: `git tag v1.0.1 && git push --tags`.

The **Release** workflow checks that the tag matches `package.json`, runs the tests, publishes to npm with provenance, and creates a GitHub release. It needs an `NPM_TOKEN` secret in the repo, an npm automation token with publish rights.

The earlier registry-server version (Next.js, Postgres, S3) is on the `archive/registry-server` branch.

## License

MIT
