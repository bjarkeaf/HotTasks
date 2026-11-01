// Bundles the real pane sources with the obsidian module stubbed, plus trace calls injected at build time.
// The repo sources stay untouched, the injection only happens inside this bundle.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const T = (s) => `window.__trace(${s});`;
const inject = {
  "pane-edit.ts": [
    ["  if (editing) return;\n  editing = true;", `  ${T('"liveEdit start", {already: editing, children: el.childElementCount, text: el.textContent}')}\n  if (editing) return;\n  editing = true;`],
    ["    if (done) return;\n    done = true;", `    ${T('"finish(" + save + ") alreadyDone=" + done + " connected=" + el.isConnected')}\n    if (done) return;\n    done = true;`],
    ['    if (save && o.multiline && v === "" && original', `    ${T('"finish value", {v, original, textContent: el.textContent, innerText: el.innerText, connected: el.isConnected}')}\n    if (save && o.multiline && v === "" && original`],
    ["!explicit) {", "!explicit && !(window as any).__noGuard) {"],
    ["    if (save && v !== original) o.onCommit(v);", `    if (save && v !== original) { ${T('"onCommit(" + JSON.stringify(v) + ")"')} o.onCommit(v); }`],
    ['  el.addEventListener("blur", () => finish(true));', `  el.addEventListener("blur", () => { ${T('"live blur"')} finish(true); });`],
    ["  if (!activeFinish || e.composedPath()", `  ${T('"onOutsideMouseDown target=" + (e.target as HTMLElement).className + " active=" + !!activeFinish')}\n  if (!activeFinish || e.composedPath()`]
  ],
  "pane.ts": [
    ["    if (isEditing() || !this.list) return;", `    ${T('"pane.render editing=" + isEditing()')}\n    if (isEditing() || !this.list) return;`],
    ["    if (!prefs.open || isEditing()) return;", `    ${T('"closeOpenItem open=" + prefs.open + " editing=" + isEditing()')}\n    if (!prefs.open || isEditing()) return;`],
    ["      focusItem(null);\n      this.render();\n    };", `      ${T('"dropFocus -> render"')}\n      focusItem(null);\n      this.render();\n    };`],
    ["        prefs.open = prefs.open === id ? null : id;", `        ${T('"toggle " + id')}\n        prefs.open = prefs.open === id ? null : id;`]
  ],
  "pane-card.ts": [["    info.replaceChildren();\n    liveEdit(info", `    ${T('"info click: replaceChildren + liveEdit"')}\n    info.replaceChildren();\n    liveEdit(info`]],
  "pane-actions.ts": [["    const before = serialize(store.doc);\n    let pending", `    ${T('"Actions.do"')}\n    const before = serialize(store.doc);\n    let pending`]]
};
const plugin = {
  name: "trace",
  setup(b) {
    b.onResolve({ filter: /^@hottasks[/]core$/ }, () => ({ path: path.join(here, "..", "..", "..", "core", "src", "index.ts") }));
    b.onResolve({ filter: /^node:/ }, () => ({ path: "node-stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default {}; export const readFile=0,writeFile=0,stat=0,mkdir=0,access=0,copyFile=0;", loader: "js" }));
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(here, "obsidian-stub.ts") }));
    b.onLoad({ filter: /src[\\/](pane-edit|pane|pane-card|pane-actions)\.ts$/ }, (a) => {
      const name = path.basename(a.path);
      let text = readFileSync(a.path, "utf8").replace(/\r\n/g, "\n");
      for (const [from, to] of inject[name] ?? []) {
        if (!text.includes(from)) throw new Error(`injection target missing in ${name}: ${from}`);
        text = text.replace(from, () => to);
      }
      return { contents: text, loader: "ts" };
    });
  }
};
await build({ entryPoints: [path.join(here, "entry.ts")], bundle: true, outfile: path.join(here, "dist", "harness.js"), format: "iife", platform: "browser", target: "es2022", plugins: [plugin], logLevel: "warning" });
console.log("built");
