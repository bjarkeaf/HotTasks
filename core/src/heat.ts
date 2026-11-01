import type { Item, Lane, Timestamp, Workstream } from "./model.js";
import { compareTimestamps, timestampFromDate, timestampToMillis } from "./model.js";

export interface HeatThresholds {
  hotMs: number;
  warmMs: number;
}

const HOUR_MS = 3_600_000;

export const DEFAULT_THRESHOLDS: HeatThresholds = { hotMs: 24 * HOUR_MS, warmMs: 72 * HOUR_MS };

export const DEFAULT_TERMINAL_STATUSES = ["Released", "Rejected", "Deleted", "Cancelled"];

export type HeatState = "hot" | "warm" | "cold" | "parked" | "terminal" | "unknown";

export interface Heat {
  state: HeatState;
  ageMs?: number;
  lastTouched?: Timestamp;
  parkedUntil?: Timestamp;
}

export interface HeatOptions {
  thresholds?: HeatThresholds;
  terminalStatuses?: string[];
}

function startOfDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

function isTerminal(item: Item, opts: HeatOptions): boolean {
  if (item.status === undefined) return false;
  const status = item.status.trim().toLowerCase();
  return (opts.terminalStatuses ?? DEFAULT_TERMINAL_STATUSES).some((s) => s.trim().toLowerCase() === status);
}

export function itemHeat(item: Item, now: Date, opts: HeatOptions = {}): Heat {
  if (isTerminal(item, opts)) return { state: "terminal" };

  const nowMs = now.getTime();
  let notBefore: Timestamp | undefined;
  for (const t of item.tasks) {
    if (t.notBefore && (!notBefore || compareTimestamps(t.notBefore, notBefore) < 0)) notBefore = t.notBefore;
  }
  // A date-only timestamp means end of day elsewhere, but parking lasts only until the day starts.
  if (notBefore && nowMs < startOfDay(notBefore.date)) {
    return { state: "parked", parkedUntil: { date: notBefore.date } };
  }

  let newest: Timestamp | undefined;
  let newestMs = -Infinity;
  const consider = (ts: Timestamp, ms: number) => {
    if (ms > newestMs) {
      newest = ts;
      newestMs = ms;
    }
  };
  for (const ev of item.events) if (ev.at) consider(ev.at, timestampToMillis(ev.at));
  if (notBefore) {
    const arrived = startOfDay(notBefore.date);
    consider(timestampFromDate(new Date(arrived)), arrived);
  }
  if (!newest) return { state: "unknown" };

  const ageMs = Math.max(0, nowMs - newestMs);
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const state: HeatState = ageMs < t.hotMs ? "hot" : ageMs < t.warmMs ? "warm" : "cold";
  return { state, ageMs, lastTouched: newest };
}

export function rollup(ws: Workstream, now: Date, opts: HeatOptions = {}): { lane: Lane; heat: Heat } {
  const all = ws.children.filter((c): c is Item => c.kind === "item");
  const lane: Lane = all.some((i) => i.lane === "now") ? "now" : all.some((i) => i.lane === "later") ? "later" : "done";

  let best: Heat | undefined;
  let parked: Heat | undefined;
  for (const item of all) {
    if (item.lane === "done") continue;
    const heat = itemHeat(item, now, opts);
    if (heat.state === "terminal") continue;
    if (heat.ageMs !== undefined) {
      if (!best || heat.ageMs < best.ageMs!) best = heat;
    } else if (heat.state === "parked" && !parked) {
      parked = heat;
    }
  }
  return { lane, heat: best ?? parked ?? { state: "unknown" } };
}

export function formatAge(ageMs: number): string {
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / 60_000)} min`;
  if (ageMs < 48 * HOUR_MS) return `${Math.floor(ageMs / HOUR_MS)} h`;
  return `${Math.floor(ageMs / (24 * HOUR_MS))} d`;
}
