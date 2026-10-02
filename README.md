<div align="center">

# ◆ skilllib

**Manage your agent skills like dependencies.**<br>
One library for all your skills. Each repo gets only the ones it needs,<br>
and every agent you use can see them.

[![npm](https://img.shields.io/npm/v/skilllib?color=8b9dff&label=npm)](https://www.npmjs.com/package/skilllib)
[![license](https://img.shields.io/badge/license-MIT-6bcb77)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A522-5eb8f7)
![agents](https://img.shields.io/badge/works%20with-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex%20%C2%B7%20Zed-c792ea)

```bash
npx skilllib
```

<img src="docs/design/repo.svg" alt="skilllib: Places on the left, a repo's skills with their issues and uses, and the selected skill's fixes and actions below" width="100%">

</div>

---

## The problem

[Agent skills](https://code.claude.com/docs/en/skills) (folders with a `SKILL.md`) are one of the best ways to teach Claude Code, Cursor, Codex and Zed how *you* work. But they pile up quickly:

- **`npx skills add`** drops skills into `~/.agents/skills`.
- **Plugins** bring their own.
- **claude.ai** syncs a few more.
- **Your teammates** commit some to the repo.
- **You** copy folders into `~/.claude/skills` "just for now".

A few weeks later:

- **🌍 Global skills load everywhere.** Everything in `~/.claude/skills` or `~/.agents/skills` loads in **every repo, in every session**. Your agent reads the name and description of your Stripe skill while fixing Terraform in your infra repo. That costs context, and skills fire when they shouldn't.
- **👯 Duplicates.** The same skill arrives through `npx skills` *and* a plugin *and* a copy in the repo, and your agent sees it twice.
- **🙈 Each agent looks somewhere else.** Claude Code reads `.claude/skills`; Codex and Zed read `.agents/skills`; Cursor reads both. The skills your team committed to `.agents/skills` are invisible to Claude Code.
- **🧟 Copies drift.** You improved a skill in one repo; the other five still have the old version.
- **🤷 No overview.** Which skills does this repo actually have? Where did each one come from? Is it committed, or only on my laptop? Does anyone use it?

Most agents can't turn off a global skill for just one repo. Claude Code can, but Cursor and Codex can't. **The only real fix is to stop using global skills and give each repo what it needs.**

## How skilllib fixes it

- **📚 Your skills: one versioned library.** Every skill has a single master copy in `~/.skilllib/library`, and each change becomes a new version.
- **📦 Per-repo installs, pinned like dependencies.** Each repo lists its skills and versions in `skilllib.json`. `sync` reproduces them exactly, and `update` moves to the newest.
- **🤝 One copy, every agent.** skilllib puts one real copy in the repo and links it into whichever folders your other agents read.
- **🧹 Health: one list of what to fix.** Global skills you haven't decided about, skills loaded twice, duplicate copies, updates, broken links, each with its fix. For a global skill: move it to the repos that need it, keep it global, or delete it. Usage numbers and descriptions help you decide.
- **✓ Global on purpose.** Some skills belong everywhere. Mark them once and skilllib stops warning about them.
- **🔎 See everything in a repo:**
  - where each skill comes from (the repo, your library, global, a plugin, claude.ai…)
  - which agents load it
  - whether it's committed to git or gitignored
  - how often it was used
- **💬 Talk to your agents about your skills.** Ask Claude Code, Cursor or Codex "which skills can you use here, and where do they come from?" or "which of my skills should this repo use?". They answer with skilllib.
- **✦ Ask an agent.** Copy a ready-made prompt with all of that data, and let Claude Code, Cursor or Codex tell you what to keep, move or delete.
- **🛟 Nothing is lost.** Every removal goes to a backup you can restore with one key.

Everything runs locally: no server, no account, no network calls.

---

## Quick start

```bash
npm install -g skilllib    # or: npx skilllib
skilllib
```

It needs **Node.js 22+** and works on macOS and Linux. Windows support is newer: it uses directory junctions, so no admin rights are needed.

On first run, skilllib asks two things:

1. **Which agents you use:** Claude Code, Cursor, Codex, Zed. The ones installed on your machine are pre-selected.
2. **Where your projects live**, e.g. `~/Projects`. It finds every git repo in there, and rescans each time it opens.

Then a good first session looks like this:

1. **You land in Places, on the repo you're in.** `enter` opens its skills; `enter` again opens a skill's issues and actions.
2. **Open Health** to see everything worth fixing, in every repo and in your global skills. **✦ Fix N issues automatically…** does the safe ones; the rest are your call, one skill at a time.
3. **Add skills** to a repo with **+ Add a skill…**, the top row of its list.

---

## Manual

### The screen

Three panes: **Places** on the left, a **list** on the right, and the **details** of what you select under it. Terminals under 80 columns get a tab bar instead of Places; under 30 rows, details open on `enter`.

| Place | What it shows |
|---|---|
| **Your skills** | Your library: master copies, versioned. Nothing here loads anywhere until you add it to a repo. |
| **Global** | Everything your agents load in *every* repo: yours, plus vendor skills (plugins, claude.ai, Cursor built-ins). |
| **Health** | Every skill with something to fix, in every repo and in Global, with its fixes. |
| **Projects** | Every repo found in your project folders. `◆` marks the one you're in; `✕` `⚠` `·` its worst issue. |
| **Settings** | Your agents and the skilllib skill for them, your project folders, hidden repos, and backups. |
| **Help** | The keys and symbols. |

### Keys

| Key | Does |
|---|---|
| *type* | Filter the pane you're in. Word initials work too: `cfw` finds `cloudflare-workers`. |
| `↑` `↓` | Move |
| `enter` `→` | One pane deeper: Places → list → details. In the details, apply the selected fix or action. |
| `esc` `←` | One pane back (`esc` clears a filter first). In the details, `←` `→` move along the actions. |
| `space` | Apply the ★ recommended fix, or show the choices when it's your call; on a group, open or close it |
| `tab` | Next tab: All · Issues · Local · Global · Plugins · Vendor |
| `ctrl+r` | Read everything again from disk · `ctrl+c` quits |

### A repo

The list shows everything agents can use in the repo, one row per skill, even when it loads from several places:

| Column | Meaning |
|---|---|
| Source | `lib v2`: from your library · `repo`: committed by your team · `untracked`: only on this machine · `global` (`global ✓`: global on purpose) · `⧉ plugin` · `claude.ai` · `cursor` |
| Uses | Claude Code uses in this repo, last 30 days |
| Issue | The worst of its issues; the details show them all |

**Related skills fold into one row**, here, in Global and in Your skills. skilllib groups them by the strongest signal it has: the same source (a plugin, an `npx skills` repo, claude.ai, Cursor), then folders you copied in the same minute (a whole set installed at once), then the same first word (`cloudflare-*`). `→` opens a group and `←` closes it; `enter` on an open group shows actions for all of it: move all to repos, keep all global, delete all, add all to repos, or a review prompt. A group you move together is recorded as its skills' origin, so it stays grouped in your library.

The top rows start something: **+ Add a skill…**, **✦ Fix N issues automatically…**, and **⋯ repo…** (open its folder, hide it from the list, copy a review prompt for its skills).

A skill's details show each issue with its fixes (★ is the recommended one; *your call* marks decisions, which are never applied automatically), then its other actions, how often it's used here, and where it loads from with its git state.

What skilllib flags:

| Issue | Fixes |
|---|---|
| **Loaded twice** (also global, or also in a plugin) | Keep the repo's copy and stop loading it globally, or keep it global. Your call: stopping a global skill changes every repo, so the fix names the repos that used it |
| **Same name as a plugin skill** | Remove the repo's copy, or turn the plugin off in this repo only (`.claude/settings.local.json`, a local-only file git ignores). Cursor ignores repo settings, so once the repo turns the plugin off, only replacing the plugin helps there |
| **Folder missing** · **Not in your library** | Restore it · copy it back into your library |
| **Update to vN** · **Edited here** | Update · save the edits as a new version, or discard them |
| ***Agent* can't see it** | Link it for every agent (links only; nothing is copied or moved) |
| **Differs from library** · **Not tracked** · **Only in this repo** | Update your library from it, or replace it · track it · import it |
| **Unused 30 days** | Remove it from the repo |
| **Broken link** · **Not reviewed** (global) | Remove the link · move it to repos, keep it global on purpose, or delete it |
| ***Agent* can't see it** (global) | Link it into that agent's global folder, e.g. a Codex skill in `~/.agents/skills` or `~/.codex/skills` gets a link in `~/.claude/skills` |

### Adding and removing skills

- **+ Add a skill…** searches your library. Its last rows create a new skill (it opens in `$EDITOR`, and goes into the repo when you close it) or copy a prompt for an agent to write it.
- **Adding** copies the newest version into the fewest folders your agents read, and records it in `skilllib.json`. Agents pick it up in their next session. The layout matches `npx skills`' symlink option: the real copy lives in `.agents/skills`, which nearly every agent reads, and Claude Code gets a link.
  - Claude Code (with or without Cursor): `.claude/skills/<name>`.
  - Cursor, Codex or Zed without Claude Code: `.agents/skills/<name>`.
  - Claude Code plus Codex or Zed: the copy goes in `.agents/skills`, with a link in `.claude/skills`. Claude Code only reads `.claude/skills`, and Codex and Zed don't read it.
- **Remove from repo** deletes that copy and its links; your library keeps it. An untracked copy goes to Settings › Backups instead. If you edited a tracked skill here, skilllib asks first.
- **The repo's own skills are never deleted by skilllib.** You can copy them into your library, or link them so every agent sees them.
- **Git-tracked folders:** if the repo commits the folder a link would go into (common for `.agents/skills`), skilllib asks once and remembers your answer. If you say no, it tells you which agents can't see the skill there. A skill whose copy git doesn't share (not committed, and not in a folder the repo commits) never gets a link in a committed folder: teammates would get a broken link.

### Versions

Every change to a library skill becomes a new version, kept in `~/.skilllib/store`. Repos pin the version they use:

```json
{ "skills": { "stripe-payments": { "version": 2, "hash": "318bf4b94df4911c" } } }
```

| | Like | What it does |
|---|---|---|
| `skilllib sync` | `npm ci` | Installs exactly the pinned versions and restores missing ones. It never touches your edits (`--force` resets them, backing them up first). |
| `skilllib outdated` | `npm outdated` | Lists skills with a newer version |
| `skilllib update [name]` | `npm update` | Moves to the newest version |
| *Other versions…* in a skill's actions | `npm i x@1` | Pins any version, including older ones |

Edit a skill once in **Your skills** (Enter → *Edit SKILL.md*). Every repo that uses it then shows `v1 → v2` and can update.

### Global skills

<img src="docs/design/global.svg" alt="Global: everything that loads in every repo, with skills installed together folded into one group and actions for the whole group" width="100%">

**Global** lists everything that loads in every repo. Each of your global skills you haven't decided about is flagged **Not reviewed**, with three choices:

- **Move it to the repos that need it…**: tick the repos (the ones where Claude Code used it are pre-ticked). It goes into your library and those repos, and stops loading globally. If a repo commits a folder one of your agents needs a link in (often `.claude/skills`), skilllib asks before adding it there.
- **Keep it global on purpose**: skilllib stops warning about it (also `skilllib global keep <name>`). The mark only records your decision; to undo it, pick **Stop marking it as global on purpose**.
- **Delete it**: it goes to Settings › Backups.

When some of your agents can't see a global skill, the flag says so (**Not reviewed · Claude Code can't see it**). This happens, for example, with a Codex skill in `~/.agents/skills` or `~/.codex/skills`, which Claude Code doesn't read. Then a fourth choice appears: **Link it for Claude Code** adds a link in `~/.claude/skills`, and nothing is copied or moved. Moving it to repos works for every agent too. For a skill you keep global on purpose, the link is the ★ fix.

Vendor skills (plugins, claude.ai, Cursor built-ins) are managed at their source: `/plugin` in Claude Code, or claude.ai's settings.

**Replacing a plugin with library skills:** on a plugin's skill or group, **Replace *plugin* with library skills…** copies all its skills into your library (grouped under the plugin), adds them to the repos you tick, and uninstalls the plugin (`claude plugin uninstall`, keeping its saved data; Settings › Backups reinstalls it). A plugin can't be half removed, so it's all its skills at once; the confirmation says what else it brings (commands, agents, hooks, MCP servers) that goes too. If the `claude` command isn't available, skilllib turns the plugin off instead and tells you to finish with `/plugin uninstall`. Plugins synced from claude.ai can't be removed from here: skilllib copies their skills and tells you to remove the plugin on claude.ai.

### Ask an agent to review your skills

Not sure what to keep? **Review prompt** puts a ready-to-paste prompt on your clipboard (also saved to `~/.skilllib/review-prompt.md`). For each skill, it includes:

- its description and SKILL.md
- how it was installed (plugin, `npx skills`, claude.ai, copied in…)
- which agents load it
- usage per repo
- duplicates
- your project list, so the agent can check each repo's stack

Paste it into Claude Code, Cursor or Codex. You get back **keep global / move to projects / delete / turn off at the vendor** for each skill, as a table plus JSON.

It's in every skill's actions, in a repo's **⋯** menu (all its skills), and at the top of Global (all your global skills).

### Ask your agents about skills

Run this once:

```bash
skilllib agent-skill install
```

This installs a small `skilllib` skill that tells your agents how to use skilllib. It goes where your agents look, in every repo: `~/.claude/skills` for Claude Code and Cursor, with a link in `~/.agents/skills` for Codex and Zed. This is the one skill that should be global, because it's about every repo. Health and Settings offer the same install, and upgrading skilllib keeps the skill up to date.

Then, in any repo, you can ask:

- *Which skills can you use in this repo?*
- *Where does each one come from?*
- *Which skills from my library would you add to this project?*
- *Is anything out of date? Update it.*

The agent runs `skilllib status --json`, `skilllib list --json` and similar commands, reads the repo, and answers. It asks before it adds or removes anything. `skilllib agent-skill remove` uninstalls it.

### Duplicates

The same skill often reaches your agents more than once: a copy in `.claude/skills` *and* in `.agents/skills`, a global copy *and* a repo copy, a plugin *and* your skill. skilllib keeps **one real copy per skill, plus only the links your agents need**. **Health** lists each case on the skill it's about, with its fix. From the command line, `skilllib doctor` lists them and `skilllib tidy` fixes the folder ones.

| What it finds | What it does |
|---|---|
| Identical copies in several folders | Keeps one and turns the others into links. In a repo, it keeps the committed copy. Globally, it keeps the one in `~/.agents/skills`. |
| Links no agent you use needs | Removes them. It keeps links that `skilllib.json` records, because teammates may use other agents. |
| **Copies that differ** | Shows which agent runs which copy (e.g. Claude Code and Cursor run `.claude`, Codex runs `.agents`), and lets you pick the one to keep. It's your call, so **Fix all** never does it. |
| A Claude Code plugin with the same skill | Your skill wins. skilllib copies all the plugin's skills into Your skills, then removes the plugin or turns it off (`claude plugin uninstall` / `disable`). If the plugin also brings MCP servers, hooks, agents or commands, turning it off is the default. When the overlap is in one repo, you can instead turn the plugin off only there (in its `.claude/settings.local.json`, which skilllib makes git ignore; without the `claude` command, skilllib writes the file itself), or remove your copy from that repo. If the repo commits its copy, it's the team's: skilllib never offers to remove it. A plugin that a repo's own `.claude/settings.json` turns on counts only in that repo. Cursor ignores repo settings: after a repo turns the plugin off, Cursor still lists both there, and only turning the plugin off or removing it changes that. |
| A Cursor plugin with the same skill | Reported only. Turn the plugin off in Cursor. |
| A repo copy of a skill you keep global | The repo copy is the extra one: remove it, or stop loading the skill globally after all. Claude Code runs the global copy anyway. |
| A repo's own skill that also loads globally | Stop loading it globally. The repo's copy is the team's, so skilllib never offers to remove it. |

- **It never moves a real copy.** `skilllib.json` is shared, so a move for your agents could break a teammate's.
- **It never adds links.** That's `skilllib link`, or a skill's *can't see it* fix.
- **It leaves committed files alone** unless you say so: Health asks first, and `skilllib tidy` needs `--allow-git`.
- **Cursor lists a skill once** even when it reaches it through several folders (tested September 2026). It runs the copy from the first of `.cursor`, `.claude`, `.codex`, `.grok`, `.agents` (seen in its app bundle, October 2026). It lists a plugin's copy and your copy separately.

### Backups

skilllib never really deletes anything you can't get back. What it removes goes to Settings › Backups, and `enter` puts it back where it came from:
- removed library skills and untracked copies go to `~/.skilllib/trash`
- removed global skills go to `~/.skilllib/global-backup`
- copies replaced by a link go to `~/.skilllib/tidy-backup`
- local edits that `skilllib doctor` discards, or that `--force` overwrites (`add`, `update`, `sync`), go to `~/.skilllib/edit-backup`
- removed plugins are listed too; restoring one reinstalls it

---

## Where skills come from

A skill is a folder with a `SKILL.md`. These are all the places your agents load them from:

| Where | Examples | Who sees it |
|---|---|---|
| **The repo** | `.claude/skills`, `.agents/skills`, `.cursor/skills`, `.codex/skills` | Agents working in that repo |
| **Subfolders** (monorepos) | `packages/web/.claude/skills`, `packages/api/.agents/skills` | Agents working in that folder. `skilllib status` lists them; skilllib never links, tracks or tidies them, since that would make them load repo-wide |
| **Global folders** | `~/.claude/skills`, `~/.agents/skills` (`npx skills add` installs here), `~/.codex/skills`, `~/.cursor/skills` | **Every repo** |
| **Vendors** | Claude Code plugins (`/plugin`), claude.ai skills, Claude Code's bundled commands, Cursor built-ins and marketplace, Codex system skills and `/etc/codex/skills` (admin) | Every repo (a repo's `.claude/settings.json` can turn a plugin on or off just there); only the vendor can remove them |
| **Your skills** | `~/.skilllib/library` | Nobody, until you add a skill to a repo |

### ✻ Claude Code · [docs](https://code.claude.com/docs/en/skills)

- **Where it looks.** When names collide, the first one listed wins:
  1. enterprise (managed settings)
  2. `~/.claude/skills` (`CLAUDE_CONFIG_DIR` moves it)
  3. `.claude/skills`, in the folder you start in and each parent up to the repo root
  4. claude.ai skills, from `~/.claude/skills/synced` (then they run only as `/anthropic-skills:name`)

  Some skills load next to these under their own name instead of competing:
  - nested `<subfolder>/.claude/skills`, once Claude touches a file there (as `/subfolder:skill`)
  - plugins (as `/plugin:skill`)
  - folders passed with `--add-dir`

  Your skill replaces a bundled command with the same name. Only direct child folders count, and links to skill folders work.
- It **doesn't read `.agents/skills`** (verified in its binary, October 2026). `claude import cursor` copies skills from there once; skilllib links them instead, so there is still one copy.
- **How it uses them.** Descriptions are always in context; the full `SKILL.md` loads on `/name` or when Claude decides it's relevant.
  - `disable-model-invocation: true`: only you can run it.
  - `user-invocable: false`: only Claude can.
- **Per-repo control.** `skillOverrides` in `.claude/settings.json` (`"off"`, `"name-only"`, `"user-invocable-only"`). It's Claude-only, so skilllib moves skills out of global instead of blocking them.

### ⬡ Cursor · [docs](https://cursor.com/docs/context/skills)

- **Where it looks.**
  - Project: `.agents/skills` and `.cursor/skills`, including nested ones, which apply only to files inside them.
  - Your home folder: `~/.agents/skills` and `~/.cursor/skills`.
  - For compatibility: `.claude/skills`, `.codex/skills`, `.grok/skills` and the same three in your home folder. The setting **Include Third-Party Plugins, Skills, and Other Configs** (on by default) turns these on, and it also imports your enabled Claude Code plugins. It always uses your home folder: `CLAUDE_CONFIG_DIR` and `CODEX_HOME` don't apply. skilllib leaves `.grok/skills` alone: it's Grok's folder, and skilllib can't tell what Grok needs.
  - Also marketplace plugins and Cursor's built-ins (`~/.cursor/skills-cursor`). Cloud Agents only see `~/.cursor/skills`.
  - It finds every `SKILL.md` up to 10 folders deep. It skips dot folders, `node_modules`, `dist` and `build`, and Codex's bundled skill names (like `skill-creator`) under `.codex/skills`.
- **How it uses them.** Descriptions decide relevance, and the full content loads on use; `/` runs one. `paths:` globs limit a skill to matching files, and `disable-model-invocation: true` makes it manual.
- **Same name in several folders.** It loads the skill once, from the first of `.cursor`, `.claude`, `.codex`, `.grok`, `.agents` (project before home folder). The claude.ai copies in `~/.claude/skills/synced` count as a different skill.
- **Limits.** There's no per-project switch for global skills.

### ◎ Codex · [docs](https://learn.chatgpt.com/docs/build-skills)

- **Where it looks.**
  - Project: `.agents/skills` in the working folder, its parents up to the repo root, and `.codex/skills`.
  - Your home folder: `~/.agents/skills`, and `~/.codex/skills` (`$CODEX_HOME/skills`). Codex's docs no longer list `~/.codex/skills`, but Codex still reads it for backward compatibility, and its built-in skill installer puts skills there (verified in its source, October 2026).
  - Also `/etc/codex/skills` (admin) and OpenAI's bundled skills in `~/.codex/skills/.system`.
  - It finds a `SKILL.md` up to 6 folders deep and skips dot folders. skilllib only lists direct children (`<folder>/<name>/SKILL.md`), which is where Codex's installer puts them.
  - It **doesn't read `.claude/skills`**, so Claude Code and Codex share no folder.
- **How it uses them.** Names and descriptions come first (about 2% of context); `SKILL.md` loads when used, and `$` picks one.
  - Same-name skills aren't merged.
  - `policy.allow_implicit_invocation: false` in `agents/openai.yaml` keeps a skill manual.
  - `[[skills.config]] … enabled = false` in `~/.codex/config.toml` disables one everywhere.

### ℤ Zed · [docs](https://zed.dev/docs/ai/skills)

- **Where it looks.** `<worktree>/.agents/skills` (trusted worktrees only) and `~/.agents/skills`, nothing else (verified in its source, October 2026). Only direct child folders count, and on a name collision the project's skill wins.
- **How it uses them.** The agent sees a catalog of names and descriptions; `/` or `@skill` runs one. Changes apply without a restart.

---

## Command line

Everything the app does also works as a command, for scripts and CI:

```
skilllib                        open the app (prints `status` when piped)
skilllib scan [folder...]       add project folders and scan them
skilllib folders [add|remove]   show or change project folders
skilllib harnesses [id...]      show or set your agents (claude-code cursor codex zed)

skilllib status                 this repo's skills
skilllib add | remove <name>    change this repo's skills
skilllib sync [--all]           install exactly the pinned versions
skilllib outdated [--all]       skills with a newer version
skilllib update [name...]       move to the newest versions
skilllib link [--all]           make every skill here usable by all your agents
skilllib tidy [--all|--global]  one real copy per skill, plus only the links your agents need

skilllib list | show <name>     your library
skilllib import <dir>...        add skill folders to your library (--global: all your global skills)
skilllib global [keep|unkeep]   your global skills; mark the ones you keep global on purpose
skilllib new <name> [desc]      create a skill

skilllib usage [--days N]       which skills Claude Code used
skilllib doctor [--fix]         find (and fix) problems
skilllib restore [name]         put back something skilllib moved out
skilllib agent-skill [install|remove]   teach your agents to use skilllib
skilllib --version
```

The repo commands (`status`, `add`, `remove`, `sync`, `outdated`, `update`, `link`, `tidy`) work in a git repo or a folder with `skilllib.json`, and never in your home folder: skills there would load in every repo. Elsewhere they stop with an error. `--all`, `tidy --global` and `status --json` work from any folder; outside a repo, `status --json` lists only the global skills.

Flags: `--force` (overwrite local edits, backed up to `~/.skilllib/edit-backup`), `--allow-tracked` (link into git-tracked folders; skills git doesn't share are still left out), `--days N`, `--json`. For `tidy`: `--dry-run` (preview), `--allow-git` (also change committed files), `<name> --keep <folder>` (the copy that wins when copies differ).

A command exits 1 when it couldn't do all you asked: a skill skipped (not in the library, or local edits in the way), links git-tracked folders blocked, an unknown `tidy` name or `--keep` folder. What it did do is still done, and listed.

**`--json`** prints one line of JSON on stdout, for scripts and agents. Messages and warnings go to stderr. It works with `status`, `list`, `show`, `projects`, `outdated`, `usage`, `doctor`, `add`, `remove`, `sync`, `update`, `import` and `agent-skill`. The output is shaped to keep agents fast and cheap:

- **`status --json`** answers everything about the repo in one call:
  - the repo's skills, with their source, version, state and git state
  - skills in subfolders (`nested`, e.g. monorepo packages), with their folder
  - the global skills, grouped by where they come from, with the plugins the repo's `.claude/settings.json` turns on or off
  - every problem skilllib found here, with its fix
  - how often Claude Code used each skill here
  - the repo's top-level files

  Skills that share every attribute are grouped, and attributes at their usual value are left out.
- **`list --json`**: inside a repo, the library skills the repo already has (names only), and the others with the first sentence of their description.
- **`add`, `remove`, `sync` and `update`** list each change and the folders it wrote to, so there's nothing left to check.

The `skilllib` skill runs `status` and `list` as it loads (in Claude Code), so an agent usually answers "which skills can you use here?" in one step.

## Files

| Path | What |
|---|---|
| `<repo>/skilllib.json` | The repo's skills and pinned versions. **Commit it.** |
| `~/.skilllib/library/` | Your skills (master copies). Worth putting under git. |
| `~/.skilllib/store/` | Every version of every skill, immutable |
| `~/.skilllib/config.json` | Your agents, project folders, hidden projects, skills you keep global |
| `~/.skilllib/trash/`, `global-backup/`, `tidy-backup/`, `edit-backup/` | Everything skilllib removed, restorable from Settings › Backups |
| `~/.skilllib/plugin-backup.json` | Plugins skilllib uninstalled, so Settings › Backups can reinstall them |
| `~/.skilllib/review-prompt.md` | The last review prompt you copied |
| `~/.claude/skills/skilllib/` | The skill that lets your agents use skilllib (`agent-skill install`) |

Environment variables: `SKILLLIB_HOME` moves `~/.skilllib`, `$VISUAL` / `$EDITOR` set the editor, and `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are honored.

## FAQ

**Does it change my repos?** Only when you tell it to: adding, removing, linking or tidying a skill, which updates `skilllib.json`. It asks before linking into a folder git tracks, and before tidy changes a committed file. It never deletes the only copy of a repo's own skill.

**Can I share skills with my team?** Commit `skilllib.json` along with the skill folders (`.agents/skills`, and `.claude/skills` if you use Claude Code). Or keep your library in a git repo and point `SKILLLIB_HOME` at it.

**Why does usage only count Claude Code?** It's the only agent here with local transcripts to read. Cursor doesn't keep them locally, and Codex's format hasn't been tested yet. That's why "unused" is a strong hint, not proof.

**What's not supported yet?**
- Turning off Cursor marketplace plugins: skilllib reports ones that duplicate your skills, but Cursor doesn't record which plugins are on in a file skilllib can read.
- Unloading a `npx skills` skill doesn't update that tool's lock file.
- Installing new skills straight from GitHub is coming. For now, `skilllib import <folder>` or copy one from a repo.

---

## Development

```bash
pnpm install
pnpm test && pnpm type-check && pnpm build   # tests run on bun
pnpm dev                                     # run from source
pnpm design                                  # render the TUI screens in docs/design
npm link                                     # use your checkout as `skilllib`
```

How the TUI is designed, and why: [docs/DESIGN.md](docs/DESIGN.md).

**Releasing:**
1. Bump `version` in `package.json` and merge to `main`.
2. Tag and push:
   ```bash
   git tag v1.6.0 && git push --tags
   ```

CI then tests on Linux, macOS and Windows, publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (no token; provenance is automatic), and creates a GitHub release.

The earlier registry-server version (Next.js, Postgres, S3) lives on the `archive/registry-server` branch.

## License

[MIT](LICENSE) © Toni Tralice
