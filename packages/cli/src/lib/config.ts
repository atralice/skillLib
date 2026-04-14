import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".skilllib");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

type Config = {
  registryUrl: string;
  auth?: {
    token: string;
  };
};

const DEFAULT_CONFIG: Config = {
  registryUrl: "http://localhost:3001/api/v1",
};

export function getConfigDir() {
  return CONFIG_DIR;
}

export function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }
  const raw = readFileSync(CONFIG_FILE, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function writeConfig(config: Config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getToken(): string | null {
  const config = readConfig();
  return config.auth?.token ?? null;
}

export function setToken(token: string) {
  const config = readConfig();
  config.auth = { token };
  writeConfig(config);
}

export function clearToken() {
  const config = readConfig();
  delete config.auth;
  writeConfig(config);
}

export function getRegistryUrl(): string {
  return readConfig().registryUrl;
}

export function setRegistryUrl(url: string) {
  const config = readConfig();
  config.registryUrl = url;
  writeConfig(config);
}
