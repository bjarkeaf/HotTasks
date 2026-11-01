import type { App } from "obsidian";
import type { Lane, Store } from "@hottasks/core";

export const VIEW_TYPE = "hottasks-pane";

export type View = "ws" | "heat";

export const LANES: Lane[] = ["now", "later", "done"];

export const LANE_NAMES: Record<Lane, string> = { now: "Now", later: "Later", done: "Done" };

/** Presentation state kept in the plugin data next to the backend settings. Nothing here is in tasks.md. */
export interface Prefs {
  /** Hue overrides per workstream ID. The default hue comes from a hash of the ID. */
  wsHues: Record<string, number>;
  view: View;
  lanes: Lane[];
  open: string | null;
  q: string;
}

export function defaultPrefs(): Prefs {
  return { wsHues: {}, view: "ws", lanes: ["now"], open: null, q: "" };
}

/** Takes whatever is in the plugin data and keeps only what is valid. */
export function readPrefs(data: Partial<Prefs> | null | undefined): Prefs {
  const prefs = defaultPrefs();
  if (!data) return prefs;
  if (data.wsHues && typeof data.wsHues === "object") {
    for (const [id, hue] of Object.entries(data.wsHues)) if (typeof hue === "number") prefs.wsHues[id] = hue;
  }
  if (data.view === "ws" || data.view === "heat") prefs.view = data.view;
  if (Array.isArray(data.lanes)) {
    const lanes = LANES.filter((l) => data.lanes?.includes(l));
    if (lanes.length > 0) prefs.lanes = lanes;
  }
  if (typeof data.open === "string") prefs.open = data.open;
  if (typeof data.q === "string") prefs.q = data.q;
  return prefs;
}

/** What the pane needs from the plugin. */
export interface PaneHost {
  app: App;
  store: Store | undefined;
  prefs: Prefs;
  /** Persists prefs, debounced. */
  savePrefs(): void;
  /** Saves an open tasks.md editor and re-reads the file, so the store sees what the editor shows. */
  flush(): Promise<void>;
  /** Re-reads everything from disk after a failed operation. */
  reopenStore(): Promise<void>;
}

/** Stable hue per workstream ID, the same colour every time. */
export function defaultHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function wsHue(prefs: Prefs, id: string): number {
  return prefs.wsHues[id] ?? defaultHue(id);
}

export function wsStyle(prefs: Prefs, id: string | undefined): string {
  if (!id) return "";
  const h = wsHue(prefs, id);
  return `--hottasks-ws: hsl(${h} 55% var(--hottasks-ws-l)); --hottasks-ws-text: hsl(${h} 45% var(--hottasks-ws-text-l));`;
}
