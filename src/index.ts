#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as commands from "./commands.js";
import { error, isJsonMode, json, setJsonMode } from "./output.js";
import { refreshAgentSkill } from "./agentSkill.js";

const HELP = `
skilllib — one library of agent skills, installed per project, visible to every agent you use

  skilllib                       Open the interactive app (run it from anywhere)
  skilllib install <source>...   Install skills from skills.sh, GitHub, or a folder
                                 (owner/repo, owner/repo@skill, a skills.sh URL, or a path)
                                 In a repo, also adds them here. --global loads them everywhere
  skilllib search <query>        Search skills.sh

Set up:
  skilllib scan [folder...]      Add folders that contain your projects and scan them
  skilllib folders [add|remove]  Show or change your project folders
  skilllib harnesses [id...]     Show or set the agents you use (skilllib harnesses lists them)
  skilllib import <dir>...       Add skill folders to the library (--force replaces)
  skilllib import --global       Copy your global skills (every agent's folder) into the library
  skilllib global [keep|unkeep <name>...]  Your global skills; mark ones you keep global on purpose
  skilllib global move <name>... --to <repo>...
                                 Load global skills only in those repos (by path or project name)

In a project (a git repo or a folder with skilllib.json; never your home folder):
  skilllib status                This project's skills, which agents load them, and issues
  skilllib add <name>...         Install library skills where your harnesses look
                                 (your personal pins, kept out of git; --shared writes
                                 skilllib.json to commit with the team)
  skilllib remove <name>...      Remove skills from this project
  skilllib link [--all]          Make every skill here usable by all your agents (adds links)
  skilllib tidy [--all|--global] One real copy per skill, plus only the links your agents need
                                 (--dry-run to preview, --allow-git to change what git sees,
                                 <name> --keep <folder> to pick the copy that wins)
  skilllib sync [--all]          Install exactly the versions in skilllib.json
  skilllib outdated [--all]      Skills with a newer version in the library
  skilllib update [name...]      Move to the newest versions (--all: every project)

Library:
  skilllib list                  Library skills, where they're installed, usage
  skilllib show <name>           Details for one skill
  skilllib new <name> [desc]     Create a skill in the library
  skilllib projects              Your projects and their skills
  skilllib usage [--days N]      Which skills agents used (from Claude Code transcripts)
  skilllib check [--days N]      What global skills and this repo's cost, and whether each was used or is current
  skilllib plugin off|on <id>    Turn a Claude Code plugin off or on (it stays installed)

Health:
  skilllib doctor [--fix]        Broken links, duplicates, out-of-date projects
  skilllib apply <id> [choice]   Apply one issue's fix, or the choice you pick (number or label)
  skilllib restore [name]        Restore something skilllib moved out of the way
  skilllib unhide <path>         Show a hidden project again

Agents:
  skilllib agent-skill [install|remove]
                                 Teach your agents to use skilllib, so you can ask them
                                 "which skills can you use here?" in any repo
  --json                         Machine-readable output (status list show projects outdated
                                 usage doctor apply add remove sync update import global move agent-skill install search check plugin)

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

/** The flags each command reads (--json works everywhere). Commands not listed take none. */
const FLAGS_OF: Record<string, string[]> = {
  "": ["days"],
  ui: [],
  status: ["days"],
  add: ["force", "allow-tracked", "personal", "shared"],
  remove: ["force"],
  sync: ["all", "force"],
  update: ["all", "force", "allow-tracked"],
  outdated: ["all"],
  list: ["days"],
  show: [],
  import: ["force", "global"],
  scan: [],
  projects: [],
  link: ["all", "allow-tracked"],
  tidy: ["all", "global", "dry-run", "allow-git", "keep"],
  harnesses: [],
  folders: [],
  unhide: [],
  new: [],
  global: ["allow-tracked", "to"],
  restore: [],
  doctor: ["fix", "days"],
  apply: ["days"],
  usage: ["days"],
  check: ["days"],
  plugin: [],
  install: ["force", "global", "all", "allow-tracked"],
  search: [],
  "agent-skill": [],
  version: [],
  help: [],
};

/** Commands that take no names or paths: run them in the repo they're about (or with --all). */
const NO_ARGS = new Set(["", "ui", "status", "outdated", "list", "projects", "link", "doctor", "usage", "check", "version"]);

async function main() {
  const argv = process.argv.slice(2);
  // Before parsing, so a bad flag is reported as JSON too.
  setJsonMode(argv.includes("--json"));
  // Flags may come first (`skilllib --json status`): the command is the first word after them.
  let at = 0;
  while (argv[at]?.startsWith("--") && !["--version", "--help"].includes(argv[at]!)) at += commands.VALUE_FLAGS.includes(argv[at]!) ? 2 : 1;
  const command = argv[at];
  const rest = [...argv.slice(0, at), ...argv.slice(at + 1)];
  const args = commands.parseArgs(rest);
  // A flag a command doesn't use is an error, not a no-op: `add --dry-run` must not quietly add.
  const takes = FLAGS_OF[command ?? ""];
  const flagOf = (a: string) => a.slice(2).split("=")[0]!; // --days 30 or --days=30
  const wrong = takes ? rest.filter((a) => a.startsWith("--") && flagOf(a) !== "json" && !takes.includes(flagOf(a))) : [];
  if (wrong.length) throw new Error(`skilllib${command ? ` ${command}` : ""} doesn't take ${wrong.join(", ")}`);
  // Nor is a stray word: `status app2` must not quietly show the repo you're in.
  if (NO_ARGS.has(command ?? "") && args.positional.length) throw new Error(`skilllib${command ? ` ${command}` : ""} doesn't take ${args.positional.join(" ")}`);
  // After an upgrade, an installed skilllib skill should describe the CLI that's now installed.
  if (!["--version", "-v", "version", "help", "--help", "-h"].includes(command ?? "")) refreshAgentSkill();
  switch (command) {
    case undefined:
      // Interactive when a person is at the terminal; plain status for scripts and pipes.
      return process.stdin.isTTY && process.stdout.isTTY ? (await import("./tui/index.js")).tui() : commands.overview(args);
    case "ui":
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("`skilllib ui` needs an interactive terminal. Agents and scripts: use `skilllib status --json`.");
      return (await import("./tui/index.js")).tui();
    case "status":
      return commands.status(args);
    case "add":
      return commands.add(args);
    case "remove":
      return commands.remove(args);
    case "sync":
      return commands.sync(args);
    case "update":
      return commands.update(args);
    case "outdated":
      return commands.outdated(args);
    case "list":
      return commands.list(args);
    case "show":
      return commands.show(args);
    case "import":
      return commands.importSkills(args);
    case "scan":
      return commands.scan(args);
    case "projects":
      return commands.projects(args);
    case "link":
      return commands.link(args);
    case "tidy":
      return commands.tidy(args);
    case "harnesses":
      return commands.harnessesCommand(args);
    case "folders":
      return commands.folders(args);
    case "unhide":
      return commands.unhide(args);
    case "new":
      return commands.newSkill(args);
    case "global":
      return commands.globalCommand(args);
    case "restore":
      return commands.restore(args);
    case "doctor":
      return commands.doctor(args);
    case "apply":
      return commands.apply(args);
    case "usage":
      return commands.usage(args);
    case "check":
      return commands.check(args);
    case "plugin":
      return commands.pluginCommand(args);
    case "agent-skill":
      return commands.agentSkill(args);
    case "install":
      return commands.install(args);
    case "search":
      return commands.search(args);
    case "--version":
    case "-v":
    case "version":
      // With --json, still one JSON document: the version as a string.
      console.log(isJsonMode() ? JSON.stringify(packageVersion()) : packageVersion());
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      if (isJsonMode()) throw new Error(`Unknown command: ${command} (skilllib help lists them)`);
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // With --json, stdout still carries one JSON document: the error.
  if (isJsonMode()) json("error", { error: message });
  error(message);
  if (process.env.DEBUG && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
