---
name: skilllib
description: Agent skills (SKILL.md) loaded in this repo and the user's skill library, via the skilllib CLI. Use for which skills you can use here and where each comes from, which library skills to add, what's out of date, broken or duplicated, and adding, removing or updating skills.
allowed-tools: Bash(skilllib:*)
---

# skilllib

The user manages agent skills with the `skilllib` CLI. Their **library** (`~/.skilllib/library`, "my skills", "the registry") holds versioned skills that load nowhere until added to a repo. A repo pins its skills in `skilllib.json`.

Always pass `--json` (one line of JSON on stdout; messages go to stderr). Never run bare `skilllib` or `skilllib ui`: that's an interactive app.

## Reading

The **Now** section at the end has this repo's `status` and `list` output. Answer from it and don't run them again. If it shows the commands instead of their output, run both in parallel.

`status --json`: `skills` are this repo's own; `global` groups load in every repo; `issues` are everything skilllib finds wrong (out-of-date or missing skills, broken links, skills loaded twice), with its `fix` (`skilllib doctor --fix` applies every fix, across all the user's projects). When asked what's out of date or broken, `issues` and each skill's `state` are the answer. Don't audit skill contents unless asked.

- `source`: `library` (added with skilllib) · `repo` (committed to `.agents/skills` by the team) · `local` (unmanaged folder) · `global` (`~/.claude/skills` or `~/.agents/skills`) · `skills.sh` (`npx skills add`; `from` is the source repo) · `plugin` (Claude Code plugin; turn off with `/plugin`) · `claude.ai` (synced from the account) · `built-in` (bundled with an agent).
- Missing fields mean the usual: loaded by all of `agents`, state ok, in `.claude/skills`. `usesHere` counts Claude Code uses in this repo.

`list --json`: `inThisProject` (names) and `skills`, the library skills the repo doesn't have, each with a short `description` and the `projects` using it. To recommend, read the repo's README and manifests (see `files` in `status`) in one parallel step, then give a reason for each pick. Don't add a skill that already loads globally (it would load twice): name it, and say `skilllib` → Global → Clean up moves it into just the repos that need it. `show <name> --json` has the full SKILL.md.

Also: `usage --json` (Claude Code usage only, so "unused" is a hint), `projects --json` (every repo), `outdated --all --json`.

## Changing (ask first unless the user asked for this exact change)

`add <name>...` · `remove <name>...` · `update [name...]` · `sync` (pinned versions) · `import <dir>` (into the library) · `doctor --fix`. Pass several names in one call. Each prints `[{name, action, from, to, dirs, reason, blocked}]`, which is the whole result: there's no need to check files afterwards.

- `skipped` + `reason`: nothing changed; tell the user. `--force` overwrites local edits, but only use it with their OK.
- `blocked`: git tracks that folder. Re-run with `--allow-tracked` only with their OK.
- Changes apply from the agent's next session. Remind the user to commit `skilllib.json` and `.claude/skills`.

To move global skills into repos, tell the user to run `skilllib` and open Global → Clean up.

## Now

This repo (`skilllib status --json`):
!`skilllib status --json`

Library skills it could add (`skilllib list --json`):
!`skilllib list --json`
