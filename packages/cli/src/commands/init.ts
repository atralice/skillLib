import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { success, error, info } from "../lib/output.js";

export function init() {
  const configPath = join(process.cwd(), "skilllib.json");

  if (existsSync(configPath)) {
    error("skilllib.json already exists");
    process.exit(1);
  }

  const config = {
    skills: {},
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  success("Created skilllib.json");
  info("Add skills with: skilllib install @owner/name --save");
}
