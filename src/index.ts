#!/usr/bin/env node
import * as commands from "./commands.js";
import { error } from "./output.js";

const HELP = `
skilllib — a library of Claude Code skills, installed per project

In a project:
  skilllib                     Show this project's skills and their status
  skilllib add <name>...       Copy skills from the library into .claude/skills/
  skilllib remove <name>...    Remove skills from this project
  skilllib sync [--all]        Update this project's skills (or every known project's) from the library

Your library (~/.skilllib/library):
  skilllib list                All library skills, where they're installed, and how much they're used
  skilllib show <name>         Details for one skill
  skilllib import <dir>...     Add skill folders to the library (--force replaces an existing one)
  skilllib import --global     Move ~/.claude/skills into the library
  skilllib scan [dir...]       Find projects with skills and remember them
  skilllib projects            Known projects and their skills
  skilllib usage [--days N]    Which skills agents used, from Claude Code transcripts

Options:
  --force    Overwrite local edits / replace existing skills
  --days N   Usage window (default 30)
`.trim();

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = commands.parseArgs(rest);
  switch (command) {
    case undefined:
    case "status":
      return commands.status(args);
    case "add":
      return commands.add(args);
    case "remove":
    case "rm":
      return commands.remove(args);
    case "sync":
      return commands.sync(args);
    case "list":
    case "ls":
      return commands.list(args);
    case "show":
      return commands.show(args);
    case "import":
      return commands.importSkills(args);
    case "scan":
      return commands.scan(args);
    case "projects":
      return commands.projects();
    case "usage":
      return commands.usage(args);
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
