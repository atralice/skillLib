import { getToken } from "../lib/config.js";
import { post } from "../lib/client.js";
import { info, error } from "../lib/output.js";

type WhoamiResponse = {
  username: string | null;
  email: string;
  firstName: string;
  lastName: string;
};

export async function whoami() {
  if (!getToken()) {
    error("Not logged in. Run: skilllib login");
    process.exit(1);
  }

  const { data } = await post<WhoamiResponse>("/auth/whoami");
  info(`${data.firstName} ${data.lastName}`);
  info(`Email: ${data.email}`);
  info(`Username: ${data.username ?? "(not set)"}`);
}
