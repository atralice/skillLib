#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as commands from "./commands.js";
import { error } from "./output.js";

const HELP = `
skilllib — one library of agent skills (Claude Code, Cursor, Codex, Zed), installed per project

  skilllib                       Open the interactive app (run it from anywhere)

Set up:
  skilllib scan [folder...]      Add folders that contain your projects and scan them
  skilllib folders [add|remove]  Show or change your project folders
  skilllib harnesses [id...]     Show or set the agents you use (claude-code cursor codex zed)
  skilllib import <dir>...       Add skill folders to the library (--force replaces)
  skilllib import --global       Copy ~/.claude/skills into the library
  skilllib global [keep|unkeep <name>...]  Your global skills; mark ones you keep global on purpose

In a project:
  skilllib status                This project's skills and their status
  skilllib add <name>...         Install library skills where your harnesses look
  skilllib remove <name>...      Remove skills from this project
  skilllib link [--all]          Make every skill here usable by all your agents (adds links)
  skilllib sync [--all]          Install exactly the versions in skilllib.json
  skilllib outdated [--all]      Skills with a newer version in the library
  skilllib update [name...]      Move to the newest versions (--all: every project)

Library:
  skilllib list                  Library skills, where they're installed, usage
  skilllib show <name>           Details for one skill
  skilllib new <name> [desc]     Create a skill in the library
  skilllib projects              Your projects and their skills
  skilllib usage [--days N]      Which skills agents used (from Claude Code transcripts)

Health:
  skilllib doctor [--fix]        Broken links, duplicates, out-of-date projects
  skilllib restore [name]        Restore something skilllib moved out of the way
  skilllib unhide <path>         Show a hidden project again

Options: --force (overwrite local edits)  --allow-tracked (link into git-tracked skill folders)  --days N
`.trim();

/** Version from the package.json shipped next to dist/. */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = commands.parseArgs(rest);
  switch (command) {
    case undefined:
      // Interactive when a person is at the terminal; plain status for scripts and pipes.
      return process.stdin.isTTY && process.stdout.isTTY ? (await import("./tui/index.js")).tui() : commands.status(args);
    case "ui":
      return (await import("./tui/index.js")).tui();
    case "status":
      return commands.status(args);
    case "add":
      return commands.add(args);
    case "remove":
    case "rm":
      return commands.remove(args);
    case "sync":
    case "install":
      return commands.sync(args);
    case "update":
    case "upgrade":
      return commands.update(args);
    case "outdated":
      return commands.outdated(args);
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
    case "link":
      return commands.link(args);
    case "harnesses":
    case "agents":
      return commands.harnessesCommand(args);
    case "folders":
    case "roots":
      return commands.folders(args);
    case "unhide":
      return commands.unhide(args);
    case "new":
    case "create":
      return commands.newSkill(args);
    case "global":
      return commands.globalCommand(args);
    case "restore":
      return commands.restore(args);
    case "doctor":
      return commands.doctor(args);
    case "usage":
      return commands.usage(args);
    case "--version":
    case "-v":
    case "version":
      console.log(packageVersion());
      return;
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
