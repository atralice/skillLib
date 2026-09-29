/**
 * Renders the TUI headless on sample data and prints screens, for checking layouts without a terminal.
 * SIZE=120x34 STEPS='["#start","down","enter","#detail"]' npx tsx src/tui/snapshot.tsx
 * RAW=1 keeps colors (add FORCE_COLOR=3 when not in a terminal).
 * Steps are space-separated keys (down up left right enter esc tab stab space bs ctrlz, or literal text); "#name" prints the screen.
 */
import { EventEmitter } from "node:events";
import { render } from "ink";
import { App } from "./App.js";
import { loadUsage, loadWorld } from "./load.js";
import { sampleWorld } from "./sample.js";

const [cols, rows] = (process.env.SIZE ?? "140x40").split("x").map(Number);
const steps: string[] = JSON.parse(process.env.STEPS ?? "[]");
class Out extends EventEmitter { columns = cols; rows = rows; isTTY = true; last = ""; write = (s: string) => { this.last = s; return true; }; }
class In extends EventEmitter {
  isTTY = true; q: string[] = [];
  setRawMode() {} setEncoding() {} ref() {} unref() {} resume() {} pause() {}
  read() { return this.q.shift() ?? null; }
  send(s: string) { this.q.push(s); this.emit("readable"); }
}
const out = new Out(), inp = new In();
// REAL=1 reads this machine instead (only navigate: fixes would change your disk).
const sample = sampleWorld();
render(process.env.REAL ? <App initial={loadWorld()} reload={loadWorld} loadUsage={loadUsage} /> : <App initial={sample} reload={() => ({ ...sample })} />, { stdout: out as any, stdin: inp as any, debug: true, exitOnCtrlC: false, patchConsole: false });
const keys: Record<string, string> = { down: "\u001B[B", up: "\u001B[A", enter: "\r", esc: "\u001B", tab: "\t", stab: "\u001B[Z", space: " ", bs: "\u007F", ctrlz: "\u001A", left: "\u001B[D", right: "\u001B[C" };
const strip = (s: string) => s.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001B\][^\u0007]*\u0007/g, "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await wait(300);
for (const step of steps) {
  if (step.startsWith("#")) { console.log(`\n===== ${step.slice(1)} =====\n` + (process.env.RAW ? out.last : strip(out.last))); continue; }
  for (const k of step.split(" ")) { inp.send(keys[k] ?? k); await wait(60); }
}
process.exit(0);
