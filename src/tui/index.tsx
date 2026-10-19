import { render } from "ink";
import { App } from "./App.js";
import { loadUsage, loadWorld } from "./load.js";
import { discoverProjects } from "../config.js";

/** Full-screen interactive mode (alternate screen, restored on exit). */
export async function tui() {
  // README: the app rescans your project folders each time it opens (new repos show up).
  discoverProjects();
  const instance = render(<App initial={loadWorld()} reload={loadWorld} loadUsage={loadUsage} />, { alternateScreen: true, exitOnCtrlC: true });
  await instance.waitUntilExit();
}
