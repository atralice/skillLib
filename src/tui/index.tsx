import { render } from "ink";
import { App } from "./App.js";
import { loadUsage, loadWorld } from "./load.js";

/** Full-screen interactive mode (alternate screen, restored on exit). */
export async function tui() {
  const instance = render(<App initial={loadWorld()} reload={loadWorld} loadUsage={loadUsage} />, { alternateScreen: true, exitOnCtrlC: true });
  await instance.waitUntilExit();
}
