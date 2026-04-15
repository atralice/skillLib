# @atralice/skilllib

CLI for the [skillLib](https://skilllib-production.up.railway.app) skill registry — publish, install, and sync Claude Code skills across machines.

## Install

```bash
npm install -g @atralice/skilllib
```

Requires Node 22 or later.

## Quickstart

```bash
# Configure registry + authenticate (get an API key from /settings/api-keys)
skilllib login

# Publish a skill from the current directory (needs a SKILL.md with frontmatter)
skilllib publish . 1.0.0

# Search the registry
skilllib search <query>

# Install a skill into ./.claude/skills/
skilllib install @owner/skill-name

# List installed skills
skilllib list
```

## Commands

| Command | Description |
|---|---|
| `login [--registry URL]` | Set registry URL and authenticate with an API key |
| `logout` | Remove stored credentials |
| `whoami` | Show current authenticated user |
| `publish [dir] [version]` | Publish a skill from a directory |
| `install <@owner/name>` | Install a skill into `.claude/skills/` |
| `install <@owner/name> --save` | Also record it in `skilllib.json` |
| `uninstall <@owner/name>` | Remove an installed skill |
| `update` | Check and apply updates for installed skills |
| `list` | List installed skills |
| `search <query>` | Search the skill registry |
| `init` | Create a `skilllib.json` in the current directory |

## Configuration

The CLI stores its config at `~/.skilllib/config.json`:

```json
{
  "registryUrl": "https://skilllib-production.up.railway.app/api/v1",
  "auth": { "token": "sk_..." }
}
```

Point at a different registry with `skilllib login --registry https://your-registry.example.com`.

## License

MIT
