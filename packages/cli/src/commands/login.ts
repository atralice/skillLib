import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setToken, setRegistryUrl, getRegistryUrl } from "../lib/config.js";
import { post } from "../lib/client.js";
import { success, error, info } from "../lib/output.js";

type WhoamiResponse = {
  username: string | null;
  email: string;
};

function normalizeRegistryUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) {
    url = `https://${url}`;
  }
  if (!/\/api\/v\d+$/.test(url)) {
    url = `${url}/api/v1`;
  }
  return url;
}

export async function login(args: string[] = []) {
  const registryFlagIdx = args.indexOf("--registry");
  const registryFlag = registryFlagIdx >= 0 ? args[registryFlagIdx + 1] : undefined;

  const rl = createInterface({ input: stdin, output: stdout });

  const currentRegistry = getRegistryUrl();
  let registryUrl: string;
  if (registryFlag) {
    registryUrl = normalizeRegistryUrl(registryFlag);
  } else {
    const answer = await rl.question(`Registry URL [${currentRegistry}]: `);
    registryUrl = answer.trim() ? normalizeRegistryUrl(answer) : currentRegistry;
  }
  setRegistryUrl(registryUrl);
  info(`Using registry ${registryUrl}`);

  const token = await rl.question("API key: ");
  rl.close();

  if (!token.startsWith("sk_")) {
    error("Invalid API key format. Keys start with sk_");
    process.exit(1);
  }

  setToken(token);

  try {
    const { data } = await post<WhoamiResponse>("/auth/whoami");
    success(`Logged in as ${data.username ?? data.email}`);
  } catch (err) {
    error(`Failed to verify credentials. Check registry URL and API key.\n  ${String(err)}`);
    process.exit(1);
  }
}
