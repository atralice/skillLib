---
name: skilllib
description: Agent skills (SKILL.md) loaded in this repo and the user's skill library, via the skilllib CLI. Use for which skills you can use here and where each comes from, which library skills to add, what's out of date, broken or duplicated, and adding, removing or updating skills.
allowed-tools: Bash(skilllib:*)
---

# skilllib

The user manages agent skills with the `skilllib` CLI. Their **library** (`~/.skilllib/library`, "my skills", "the registry") holds versioned skills that load nowhere until added to a repo. A repo pins its skills in `skilllib.json`.

Always pass `--json` (one line of JSON on stdout; messages go to stderr). A failure exits 1 with `{"error": "..."}` as that line. `link`, `tidy`, `global keep`/`unkeep`, `restore`, `new`, `folders`, `harnesses`, `scan` and `unhide` print messages only (read the exit code). Unknown flags are errors. Never run bare `skilllib` or `skilllib ui`: that's an interactive app.

## Reading

The **Now** section at the end has this repo's `status` and `list` output. Answer from it and don't run them again. If it shows the commands instead of their output, run both in parallel.

`status --json`: `skills` are this repo's own; `nested` (when there are any) are in subfolders such as monorepo packages, and load only when the agent works in their `dir`; `global` groups load in every repo, as this repo loads them (its `.claude/settings.json` can turn a plugin on or off); `issues` are everything skilllib finds wrong (out-of-date or missing skills, broken links, skills loaded twice), one `ids` entry per `problems` entry, with a `fix` (a safe repair; `skilllib doctor --fix` applies every fix, across all the user's projects), `choices` (decisions: propose one, and apply it once the user agrees, see Changing), or neither (reported only: tell the user what it says). When asked what's out of date or broken, `issues` and each skill's `state` are the answer. Don't audit skill contents unless asked.

- `source`: `library` (added with skilllib) · `repo` (the team's: committed to git, or in `.agents/skills`) · `local` (only on this machine: not committed, not managed by skilllib) · `global` (a global folder an agent of yours reads: `~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.grok/skills`) · `skills.sh` (`npx skills add`; `from` is the source repo) · `plugin` (Claude Code plugin; turn off with `/plugin`) · `claude.ai` (synced from the account) · `built-in` (bundled with an agent) · `system` (an admin's folder, such as `/etc/codex/skills`) · `skilllib` (this skill; `skilllib agent-skill remove` takes it out).
- Missing fields mean the usual: loaded by all of `agents`, state ok (or, for a repo's own or untracked skill, its usual state), in `.claude/skills`. `usesHere` counts Claude Code uses in this repo.

`list --json`: `inThisProject` (names) and `skills`, the library skills the repo doesn't have, each with a short `description` and the `projects` using it. To recommend, read the repo's README and manifests (see `files` in `status`) in one parallel step, then give a reason for each pick. Don't add a skill that already loads globally (it would load twice): offer to move it into just the repos that need it instead (`global move`). `show <name> --json` has the full SKILL.md.

Also: `usage --json` (Claude Code usage only, so "unused" is a hint; each skill lists the `projects` that used it), `projects --json` (every repo), `outdated --all --json`, `doctor --json` (every issue in every repo and globally, each with an `id`).

## Changing (ask first unless the user asked for this exact change)

`add <name>...` · `remove <name>...` (skills skilllib manages, `source: library`) · `update [name...]` · `sync` (installs what `skilllib.json` pins; takes no names). Pass several names in one call. Their result is `[{name, action, from, to, dirs, reason, blocked, uncommitted, backedUp}]`, which is the whole result: there's no need to check files afterwards. `import <dir>...` (into the library) prints `[{path, name, status}]` and exits 1 if a folder was skipped (`exists`, `no SKILL.md`). `doctor --fix` prints doctor's issues, each fix with `fixed: {ok, message}`.

- `skipped` + `reason`: nothing changed for that skill, and the command exits 1; tell the user. `--force` overwrites local edits (`backedUp` says where they went; `skilllib restore <name>` brings them back), but only use it with their OK.
- `blocked`: git tracks that folder. Re-run with `--allow-tracked` (for that command only) only with their OK.
- `uncommitted`: git tracks that folder but not the skill's real copy, so a link there would break for teammates; `--allow-tracked` doesn't change that. Once the copy is committed, `link --allow-tracked` adds it.
- Changes apply from the agent's next session. Remind the user to commit `skilllib.json` and the folders in `dirs`.

**Prefer per-repo skills to global ones.** A global skill loads in every repo, for every agent. When `usage --json` shows one used in only a few repos, propose moving it there:

- `global move <name>... --to <repo>[,<repo>...]` (a project name from `projects`, or the path of a repo's top folder): imports it into the library, adds it to each repo, and only then stops loading it globally (restorable with `skilllib restore`). Prints `[{skill, moved, reason, projects: [{project, path, change}]}]`; `moved: false` means it still loads globally, and `reason` says why (for example, git tracks the folder a link goes in, so an agent couldn't see it there: re-run with `--allow-tracked` only with the user's OK).
- `global keep <name>...`: the user wants it everywhere; skilllib stops flagging it.

**Fixes and decisions.** `apply <id> [choice]` runs one problem's `fix`, or the choice you name: its label (safest), or its number from 1. With several choices it needs one. Prints `{id, applied, ok, message}`. Ids come from `issues` in `status --json` (Now, below) or from `doctor --json` (every repo; pass `apply` the same `--days` you gave `doctor`). A few issues span repos and offer different choices in each; then `apply` takes only the label.

**Importing.** `import <dir>...` copies skill folders (each with a `SKILL.md`) into the library; skilllib doesn't download anything. For a skill on GitHub, clone the repo into a temporary folder, `import` the skill's folder, then `add` it here.

## Now

This repo (`skilllib status --json`):
!`skilllib status --json`

Library skills it could add (`skilllib list --json`):
!`skilllib list --json`
