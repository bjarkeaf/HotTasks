// Drives the harness page in headless Edge with real mouse and key input over CDP.
// usage: node run.mjs [--guard=off] [--trace] [--only=3,5] [--modes=append:20,empty:20]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const guard = args.guard ?? "on";
const only = args.only ? args.only.split(",").map(Number) : null;
const modes = (args.modes ?? "append:20,empty:20,append:400,empty:400").split(",").map((m) => m.split(":"));
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), "ht-edge-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=600,800", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("no Edge");
}
const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) pending.get(d.id)(d);
  if (d.method === "Runtime.exceptionThrown") console.log("PAGE ERROR", JSON.stringify(d.params.exceptionDetails).slice(0, 400));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; })()`);
async function mouseClick(sel, dx = null, dy = null) {
  const r = await rect(sel);
  if (!r) throw new Error("missing " + sel);
  const x = dx === null ? r.x + r.w / 2 : r.x + dx;
  const y = dy === null ? r.y + r.h / 2 : r.y + dy;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const key = async (k) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: 27 });
};

const A = '[data-id="it-aaaa"]';
const B = '[data-id="it-bbbb"]';
const sel = {
  rowA: `${A} .hottasks-bar`,
  rowB: `${B} .hottasks-bar`,
  info: `${A} .hottasks-info`,
  blank: ".hottasks-title",
  tickAOpen: `${A} .hottasks-tasks:not(.hottasks-closed) .hottasks-tk input[type=checkbox]`,
  tickBClosed: `${B} .hottasks-tasks.hottasks-closed input[type=checkbox]`
};
const clickInfo = () => mouseClick(sel.info, 6, 8);

// Synthetic events in the same macrotask, with the browser's mousedown focus change emulated.
const syntheticSame = `(() => {
  const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
  const click = (el) => { fire(el, "mousedown"); fire(el, "mouseup"); fire(el, "click"); };
  click(document.querySelector(${JSON.stringify(sel.rowA)}));
  click(document.querySelector(${JSON.stringify(sel.info)}));
})()`;

const scenarios = {
  1: ["open, click Info, click blank", async () => { await mouseClick(sel.rowA); await sleep(200); await clickInfo(); await sleep(150); await mouseClick(sel.blank); }],
  2: ["click Info in same macrotask as opening, then click blank", async () => { await ev(syntheticSame); await sleep(150); await mouseClick(sel.blank); }],
  3: ["open, click Info, Escape", async () => { await mouseClick(sel.rowA); await sleep(200); await clickInfo(); await sleep(150); await key("Escape"); }],
  4: ["open, click Info, click another item's row", async () => { await mouseClick(sel.rowA); await sleep(200); await clickInfo(); await sleep(150); await mouseClick(sel.rowB); }],
  5: ["open, tick task, click Info, click blank", async () => { await mouseClick(sel.rowA); await sleep(200); await mouseClick(sel.tickAOpen); await sleep(300); await clickInfo(); await sleep(150); await mouseClick(sel.blank); }],
  6: ["open, click Info twice quickly, click blank", async () => { await mouseClick(sel.rowA); await sleep(200); await clickInfo(); await sleep(30); await clickInfo(); await sleep(150); await mouseClick(sel.blank); }],
  7: ["open, click Info, pane.render() while editing (60 s timer), click blank", async () => { await mouseClick(sel.rowA); await sleep(200); await clickInfo(); await sleep(150); await ev("__pane.render()"); await sleep(100); await mouseClick(sel.blank); }],
  8: ["tick task on closed B, open A, click Info, click blank", async () => { await mouseClick(sel.tickBClosed); await sleep(300); await mouseClick(sel.rowA); await sleep(200); if (!(await rect(sel.info))) { console.log("  (first click lost: the mousedown redraw removed its target, so no click fired. Clicking again.)"); await mouseClick(sel.rowA); await sleep(200); } await clickInfo(); await sleep(150); await mouseClick(sel.blank); }],
  9: ["open, click Info before the async render resolves (real input, delay 400 only matters), click blank", async () => { await mouseClick(sel.rowA); await sleep(10); await clickInfo(); await sleep(600); await mouseClick(sel.blank); }]
};

const url = (mode, delay) => pathToFileURL(path.join(here, "page.html")).href + `?md=${mode}&delay=${delay}&guard=${guard}`;
let anyLoss = false;
for (const [mode, delay] of modes) {
  console.log(`\n=== markdown render: ${mode}, delay ${delay} ms, guard ${guard} ===`);
  for (const [n, [title, run]] of Object.entries(scenarios)) {
    if (only && !only.includes(Number(n))) continue;
    await send("Page.navigate", { url: url(mode, delay) });
    for (let i = 0; i < 50 && !(await ev("!!window.__ready").catch(() => false)); i++) await sleep(100);
    await sleep(100);
    await ev("__host.prefs.open = null; 0");
    try { await run(); } catch (e) { console.log("  step failed:", e.message); }
    await sleep(Number(delay) + 400);
    const out = await ev(`JSON.stringify({ text: __files.get("tasks.md"), log: __log, active: document.activeElement && document.activeElement.className })`);
    const { text, log } = JSON.parse(out);
    const a = text.split("\n").slice(text.split("\n").findIndex((l) => l.includes("^it-aaaa")) + 1);
    const infoLines = a.filter((l) => /Info line|\[the docs\]/.test(l));
    const survived = infoLines.length === 3;
    const refused = log.some((l) => l.includes("refused to save"));
    const emptied = log.some((l) => l.includes('onCommit("")'));
    if (!survived) anyLoss = true;
    console.log(`${survived ? "OK  " : "LOST"} scenario ${n}: ${title}  | info lines in file: ${infoLines.length}${refused ? " | guard refused an empty save" : ""}${emptied ? " | onCommit(\"\") ran" : ""}${log.some((l) => l.includes("onCommit(")) && !emptied ? " | onCommit with changed text" : ""}`);
    if (args.trace || !survived || refused) for (const l of log) console.log("      " + l);
    if (args.text) console.log(text);
  }
}
ws.close();
edge.kill();
process.exit(anyLoss ? 1 : 0);
