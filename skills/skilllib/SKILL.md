---
name: skilllib
description: Answer questions about agent skills and change them with the skilllib CLI. Use when the user asks which skills are available or loaded in this repo, where a skill comes from, which skills to add, remove, update or clean up, which skills from their library suit this project, or anything about skilllib, skilllib.json, ~/.skilllib, or global vs project skills.
---

# skilllib

skilllib manages the user's agent skills (Claude Code, Cursor, Codex, Zed) like dependencies:

- **The library** (`~/.skilllib/library`) holds one versioned master copy of each of the user's skills. The user calls it "my skills" or "the registry". A library skill loads nowhere until it is added to a repo.
- **A repo** lists its skills and pinned versions in `skilllib.json`. `skilllib add` copies the skill into `.claude/skills/<name>` and links it into `.agents/skills` when Codex or Zed are in use.
- **Global skills** (`~/.claude/skills`, `~/.agents/skills`, plugins, claude.ai) load in every repo. The user's goal is usually to have fewer of them.

## How to call it

Always run commands with `--json` and read stdout. Messages and warnings go to stderr. Run from the repo you're asked about: commands find the project root from the working directory.

Never run `skilllib` with no arguments or `skilllib ui`: that opens an interactive app for a person.

If `skilllib` isn't on PATH, use `npx -y skilllib`.

## Answering questions

| The user asks | Run | Then |
|---|---|---|
| Which skills can you use here? | `skilllib status --json` | Group `skills` by `scope` (project, global). Say which agents load each (`loadedBy`). |
| Where do they come from? | `skilllib status --json` | Explain `source` and `origin` per skill (table below). |
| Which of my skills should this repo use? | `skilllib list --json` | Look at the repo (README, package.json, languages, frameworks). Suggest skills where `inThisProject` is false and the `description` fits. Give a reason for each, then ask before adding. |
| What's in my library? Tell me about skill X. | `skilllib list --json`, `skilllib show <name> --json` | Read the `SKILL.md` at `path` for details. |
| Is anything out of date or broken? | `skilllib outdated --json`, `skilllib doctor --json` | |
| Which skills are actually used? | `skilllib usage --json` | Counts come from Claude Code transcripts only, so "unused" is a hint, not proof. |
| Which of my repos use what? | `skilllib projects --json` | |

`source` values in `status --json`:

| source | Meaning | Who can change it |
|---|---|---|
| `library` | Added from the user's library; pinned in `skilllib.json` | `skilllib remove` / `update` |
| `repo` | Committed to the repo's `.agents/skills` by the team | The repo; skilllib never deletes these |
| `local` | A folder in the repo's skill folders that skilllib doesn't manage | `skilllib import <path>` brings it into the library |
| `global` | A folder in `~/.claude/skills` or `~/.agents/skills` | The user, via the skilllib app's cleanup wizard |
| `skills.sh` | Installed globally with `npx skills add` (`origin` is the source repo) | `npx skills remove`, or the skilllib app |
| `claude.ai` | Synced from the user's claude.ai account | claude.ai settings |
| `plugin` | Ships with a Claude Code plugin (`origin` is `plugin@marketplace`) | `/plugin` in Claude Code |
| `built-in` | Bundled with an agent, or with skilllib itself | Can't be removed |

`yours: false` means a vendor manages the skill. `state` values that need attention: `update available` (run `skilllib update <name>`), `edited locally` (the repo copy differs from its pinned version), `folder missing` (run `skilllib sync`).

## Making changes

Ask the user before running any command that changes files, unless they already asked for that exact change.

| Goal | Command |
|---|---|
| Add library skills to this repo | `skilllib add <name>... --json` |
| Remove skills from this repo | `skilllib remove <name>... --json` |
| Install exactly the pinned versions | `skilllib sync --json` |
| Move to the newest versions | `skilllib update [name...] --json` |
| Put a skill folder into the library | `skilllib import <dir> --json` |
| Create a new library skill | `skilllib new <name> "<description>"` |
| Fix what `doctor` found | `skilllib doctor --fix --json` |

Write commands print a list of changes: `{ "name", "action": "installed" | "updated" | "removed" | "skipped", "from", "to", "reason", "blocked" }`. With `--all`, `sync` and `update` print one `{ "project", "path", "changes" }` per project.

- `skipped` with a `reason`: nothing changed. Tell the user why. If the reason mentions local edits, `--force` overwrites them. Only use `--force` when the user agrees.
- `blocked`: git tracks that folder, so no link was added there. Re-run with `--allow-tracked` only if the user agrees.
- Agents pick up added skills in their next session, not the current one.
- Removing a skill never touches the library or other repos. Remind the user to commit `skilllib.json` and `.claude/skills` so teammates get the same skills.
- Moving global skills into repos is done in the skilllib app: tell the user to run `skilllib` and open **Global → Clean up**.
