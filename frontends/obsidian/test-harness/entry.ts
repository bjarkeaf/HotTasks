import { Store, withDefaults } from "@hottasks/core";
import type { FileSystem } from "@hottasks/core";
import { HotTasksPane } from "../src/pane";
import { defaultPrefs } from "../src/pane-state";

const params = new URLSearchParams(location.search);
window.__md = { mode: (params.get("md") as "append" | "empty") ?? "append", delay: Number(params.get("delay") ?? 20) };
const t0 = performance.now();
const log: string[] = [];
(window as any).__log = log;
window.__trace = (...a) => log.push(`${(performance.now() - t0).toFixed(0).padStart(5)}ms ` + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
const ow = console.warn;
console.warn = (...a) => { window.__trace("console.warn", ...a); ow(...a); };
(window as any).__noGuard = params.get("guard") === "off";

const TASKS = `## Task status

- WS One ^ws-1111
	- [ ] Item A ^it-aaaa
		- **Task one**
		- **Task two**
		- Info line one
		- See [the docs](https://example.com) for more
		- Info line three
		- @2026-10-31 10:00 Started
	- [ ] Item B ^it-bbbb
		- **Task for B**
		- Info of B
		- @2026-10-31 11:00 Started B
	- [ ] Item C ^it-cccc
		- Info of C
		- @2026-10-31 12:00 Started C
`;
/** Made-up data for the README screenshot, stamped relative to now so every heat colour shows. */
function demo(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = (hoursAgo: number) => {
    const d = new Date(Date.now() - hoursAgo * 3_600_000);
    return `@${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `## Task status

- Sensor board rev B ^ws-d001
	- [ ] ECO-104233: *Second Review* ^it-d001
		- **Chase remaining signers**
		- Needs QA and Purchasing sign-off
		- ${at(52)} Submitted for review
		- ${at(3)} Reminded Purchasing in chat
		- ${at(1.5)} Status: Second Review
	- [ ] Stencil thickness ^it-d002
		- **Confirm 120 um with assembly house**
		- **Update fab notes**
		- ${at(30)} Asked assembly house
	- [ ] Connector second source ^it-d003
		- **Request samples from Vendor B**
		- ${at(150)} Datasheets compared
- Test fixture ^ws-d002
	- [ ] Pogo pin plate ^it-d004
		- **Review drawing with mechanics**
		- ${at(5)} Drawing received
	- [ ] Fixture cable: *Released* ^it-d005
		- **Order 10 pcs**
		- ${at(96)} Status: Released
- [ ] Lab PC upgrade ^it-d006
	- **Follow up with IT on ticket**
	- ${at(200)} Ticket opened
`;
}

const files = new Map<string, string>([["tasks.md", params.has("demo") ? demo() : TASKS]]);
(window as any).__files = files;
const fs: FileSystem = {
  read: async (p) => files.get(p),
  write: async (p, t) => void files.set(p, t),
  exists: async (p) => files.has(p),
  mkdir: async () => undefined,
  mtime: async (p) => (files.has(p) ? 1 : undefined)
};

void (async () => {
  const store = await Store.open(withDefaults({ snapshots: false }), fs);
  const prefs = defaultPrefs();
  if (params.has("demo")) {
    prefs.open = "it-d001";
    prefs.wsHues = { "ws-d002": 25 };
  }
  const host: any = {
    app: { workspace: {} },
    store,
    prefs,
    savePrefs() {},
    flush: async () => {
      await store.reloadIfChanged();
    },
    reopenStore: async () => {}
  };
  const pane = new HotTasksPane({} as any, host);
  document.getElementById("view")!.appendChild(pane.contentEl);
  store.onChange(() => pane.render());
  await pane.onOpen();
  Object.assign(window as any, { __pane: pane, __store: store, __host: host, __ready: true });
})();
