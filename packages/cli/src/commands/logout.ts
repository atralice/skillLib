import { clearToken } from "../lib/config.js";
import { success } from "../lib/output.js";

export function logout() {
  clearToken();
  success("Logged out");
}
