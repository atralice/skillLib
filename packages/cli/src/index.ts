#!/usr/bin/env node

import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { publish } from "./commands/publish.js";
import { install } from "./commands/install.js";
import { uninstall } from "./commands/uninstall.js";
import { update } from "./commands/update.js";
import { list } from "./commands/list.js";
import { search } from "./commands/search.js";
import { init } from "./commands/init.js";

const HELP = `
skilllib — CLI for the skillLib skill registry

Usage:
  skilllib <command> [options]

Commands:
  login                     Authenticate with your API key
  logout                    Remove stored credentials
  whoami                    Show current authenticated user
  publish [dir] [version]   Publish a skill from a directory
  install <@owner/name>     Install a skill to .claude/skills/
  uninstall <@owner/name>   Remove an installed skill
  update                    Check and apply updates
  list                      List installed skills
  search <query>            Search the skill registry
  init                      Create skilllib.json in current directory
  help                      Show this help message

Examples:
  skilllib login
  skilllib publish . 1.0.0
  skilllib install @alice/react-patterns
  skilllib install @alice/react-patterns --save
  skilllib search "react"
`.trim();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "login":
      await login();
      break;
    case "logout":
      logout();
      break;
    case "whoami":
      await whoami();
      break;
    case "publish":
      await publish(commandArgs);
      break;
    case "install":
      await install(commandArgs);
      break;
    case "uninstall":
      await uninstall(commandArgs);
      break;
    case "update":
      await update(commandArgs);
      break;
    case "list":
    case "ls":
      await list();
      break;
    case "search":
      await search(commandArgs);
      break;
    case "init":
      init();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
