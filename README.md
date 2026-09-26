# skilllib

Keep one library of Claude Code skills and choose which skills each project gets. It runs entirely on your machine: there's no server and no account.

- **Library:** `~/.skilllib/library/<skill>/`, a plain folder of skills. It's worth putting under git for history.
- **Per project:** `skilllib add` copies a skill into the project's `.claude/skills/` and records it in `skilllib.json`. Projects get only the skills you pick, and nothing loads globally.
- **Keeping copies in sync:** `skilllib sync` updates project copies when the library changes, and keeps your local edits unless you pass `--force`. `skilllib import` sends a project's edits back to the library.
- **Usage:** `skilllib usage` reads your Claude Code transcripts (`~/.claude/projects`) to show which skills agents actually used. It needs no hooks or setup.

## Setup

```bash
pnpm install && pnpm build && npm link   # puts `skilllib` on your PATH
```

## First run

```bash
skilllib scan ~/Projects          # find projects that have skills
skilllib import --global          # copy ~/.claude/skills into the library
skilllib import ~/Projects/app/.claude/skills/deploy-notes
skilllib list                     # every skill: description, projects, usage
skilllib usage                    # what agents actually used in the last 30 days
```

`import --global` copies your global skills and leaves the originals in place. Once your projects use library copies, delete the global ones from `~/.claude/skills` yourself so they stop loading everywhere.

## In a project

```bash
skilllib                          # this project's skills and their status
skilllib add ponytail deploy-notes
skilllib remove ponytail
skilllib sync                     # pull library updates (sync --all: every known project)
```

A skill can be in one of these states:

| Status | What it means | What to do |
|---|---|---|
| `ok` | Same as the library | Nothing |
| `update available` | The library changed | `skilllib sync` |
| `edited locally` | You changed the project copy | `skilllib import .claude/skills/<name> --force` to keep the change |
| `local only` | Not in the library | `skilllib import .claude/skills/<name>` |
| `untracked copy of library skill` | Same name as a library skill, but not managed | `skilllib add <name>` |

Symlinked skills (for example, links into `~/.agents/skills`) are copied as real files. Editing a copy never changes the original.

## Files

- `skilllib.json` (in each project): the library skills this project uses, with the hash of the installed copy. Commit it with `.claude/skills/`.
- `~/.skilllib/projects.json`: projects skilllib knows about, from `add`, `sync`, `import`, and `scan`.

Set `SKILLLIB_HOME` to move `~/.skilllib`. Usage honors `CLAUDE_CONFIG_DIR`.

## Development

```bash
pnpm test        # bun test
pnpm type-check
```

The earlier registry server (Next.js, Postgres, S3, API) is kept on the `archive/registry-server` branch.
