import React from "react";
import { render } from "ink";
import { App } from "./App.js";

/** Full-screen interactive mode (alternate screen, restored on exit). */
export async function tui() {
  const instance = render(<App />, { alternateScreen: true, exitOnCtrlC: true });
  await instance.waitUntilExit();
}
