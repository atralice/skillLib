import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setToken } from "../lib/config.js";
import { post } from "../lib/client.js";
import { success, error } from "../lib/output.js";

type WhoamiResponse = {
  username: string | null;
  email: string;
};

export async function login() {
  const rl = createInterface({ input: stdin, output: stdout });
  const token = await rl.question("API key: ");
  rl.close();

  if (!token.startsWith("sk_")) {
    error("Invalid API key format. Keys start with sk_");
    process.exit(1);
  }

  // Temporarily set token to validate it
  setToken(token);

  const { data } = await post<WhoamiResponse>("/auth/whoami");
  success(`Logged in as ${data.username ?? data.email}`);
}
