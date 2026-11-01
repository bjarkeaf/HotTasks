import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, findItem, findWorkstream } from "../src/index.js";
import type { Item, Workstream } from "../src/index.js";
import { DEFAULT_THRESHOLDS, formatAge, itemHeat, rollup } from "../src/heat.js";

const canonical = readFileSync(join(__dirname, "fixtures", "canonical.md"), "utf8");
const now = new Date(2026, 10, 1, 12, 0);
const HOUR = 3_600_000;

function build(lines: string[]): Item {
  const doc = parse(["- [ ] Thing ^it-aaaa", ...lines.map((l) => `\t${l}`)].join("\n"), { today: "2026-11-01" });
  return findItem(doc, "it-aaaa")!.item;
}

function ago(hours: number): string {
  const d = new Date(now.getTime() - hours * HOUR);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `@${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function workstream(body: string[]): Workstream {
  const doc = parse(["- WS ^ws-aaaa", ...body.map((l) => `\t${l}`)].join("\n"), { today: "2026-11-01" });
  return findWorkstream(doc, "ws-aaaa")!;
}

describe("itemHeat", () => {
  it("is hot under 24 h", () => {
    const heat = itemHeat(build([`- ${ago(2)} Did it`]), now);
    expect(heat.state).toBe("hot");
    expect(heat.ageMs).toBe(2 * HOUR);
    expect(heat.lastTouched).toEqual({ date: "2026-11-01", time: "10:00" });
  });

  it("treats exactly 24 h as warm", () => {
    expect(itemHeat(build([`- ${ago(24)} Did it`]), now).state).toBe("warm");
    expect(itemHeat(build([`- ${ago(23.9)} Did it`]), now).state).toBe("hot");
  });

  it("treats exactly 72 h as cold", () => {
    expect(itemHeat(build([`- ${ago(72)} Did it`]), now).state).toBe("cold");
    expect(itemHeat(build([`- ${ago(71.9)} Did it`]), now).state).toBe("warm");
  });

  it("uses the newest event", () => {
    const heat = itemHeat(build([`- ${ago(100)} Old`, `- ${ago(5)} New`]), now);
    expect(heat.ageMs).toBe(5 * HOUR);
  });

  it("counts inherited event timestamps", () => {
    const item = build([`- ${ago(30)} Started`, "- Lazy line below"]);
    expect(item.events[1]!.explicit).toBe(false);
    const heat = itemHeat(item, now);
    expect(heat.ageMs).toBe(30 * HOUR);
    expect(heat.state).toBe("warm");
  });

  it("is unknown without timestamps", () => {
    expect(itemHeat(build(["- **Do a thing**", "- A fact"]), now)).toEqual({ state: "unknown" });
    expect(itemHeat(build([]), now)).toEqual({ state: "unknown" });
  });

  it("is terminal with no age, ignoring case and whitespace", () => {
    const doc = parse(`- [ ] X: *released* ^it-aaaa\n\t- ${ago(1)} Done`, { today: "2026-11-01" });
    expect(itemHeat(findItem(doc, "it-aaaa")!.item, now)).toEqual({ state: "terminal" });
  });

  it("terminal wins over a future task date", () => {
    const doc = parse(`- [ ] X: *Cancelled* ^it-aaaa\n\t- **Wait** @2026-12-01`, { today: "2026-11-01" });
    expect(itemHeat(findItem(doc, "it-aaaa")!.item, now).state).toBe("terminal");
  });

  it("honours custom terminal statuses", () => {
    const doc = parse(`- [ ] X: *On hold* ^it-aaaa\n\t- ${ago(1)} Note`, { today: "2026-11-01" });
    const item = findItem(doc, "it-aaaa")!.item;
    expect(itemHeat(item, now).state).toBe("hot");
    expect(itemHeat(item, now, { terminalStatuses: [" on hold "] }).state).toBe("terminal");
  });

  it("parks an item whose task is dated tomorrow", () => {
    const heat = itemHeat(build([`- **Wait** @2026-11-02`, `- ${ago(1)} Note`]), now);
    expect(heat).toEqual({ state: "parked", parkedUntil: { date: "2026-11-02" } });
  });

  it("does not park an item whose task is dated today", () => {
    const heat = itemHeat(build([`- **Wait** @2026-11-01`]), now);
    expect(heat.state).toBe("hot");
    expect(heat.ageMs).toBe(12 * HOUR);
    expect(heat.lastTouched).toEqual({ date: "2026-11-01", time: "00:00" });
  });

  it("is parked one minute before midnight and live at midnight", () => {
    const item = build([`- **Wait** @2026-11-02`]);
    expect(itemHeat(item, new Date(2026, 10, 1, 23, 59)).state).toBe("parked");
    const heat = itemHeat(item, new Date(2026, 10, 2, 0, 0));
    expect(heat.state).toBe("hot");
    expect(heat.ageMs).toBe(0);
  });

  it("lets a task date that has arrived beat an older event", () => {
    const heat = itemHeat(build([`- **Wait** @2026-10-30`, `- ${ago(100)} Old`]), now);
    expect(heat.ageMs).toBe(60 * HOUR);
    expect(heat.state).toBe("warm");
  });

  it("keeps a newer event over an arrived task date", () => {
    const heat = itemHeat(build([`- **Wait** @2026-10-30`, `- ${ago(3)} Recent`]), now);
    expect(heat.ageMs).toBe(3 * HOUR);
  });

  it("applies custom thresholds", () => {
    const item = build([`- ${ago(2)} Did it`]);
    const thresholds = { hotMs: HOUR, warmMs: 3 * HOUR };
    expect(itemHeat(item, now, { thresholds }).state).toBe("warm");
    expect(DEFAULT_THRESHOLDS).toEqual({ hotMs: 24 * HOUR, warmMs: 72 * HOUR });
  });

  it("treats done items like any other", () => {
    const doc = parse(`- [x] X ^it-aaaa\n\t- ${ago(1)} Done`, { today: "2026-11-01" });
    expect(itemHeat(findItem(doc, "it-aaaa")!.item, now).state).toBe("hot");
  });
});

describe("itemHeat on canonical", () => {
  const doc = parse(canonical, { today: "2026-11-01" });

  it("parks the MCO item until its task date", () => {
    expect(itemHeat(findItem(doc, "it-9q7d")!.item, now)).toEqual({
      state: "parked",
      parkedUntil: { date: "2026-11-02" }
    });
  });

  it("reports the Released item as terminal", () => {
    expect(itemHeat(findItem(doc, "it-5h1n")!.item, now).state).toBe("terminal");
  });

  it("computes age for an ordinary item", () => {
    const heat = itemHeat(findItem(doc, "it-7x1a")!.item, now);
    expect(heat.state).toBe("cold");
    expect(heat.lastTouched).toEqual({ date: "2026-10-14", time: "08:00" });
  });

  it("is unknown for an item with no timestamps", () => {
    expect(itemHeat(findItem(doc, "it-0a0a")!.item, now).state).toBe("unknown");
  });
});

describe("rollup", () => {
  it("picks the hottest open item", () => {
    const ws = workstream([
      "- [ ] A ^it-aaa1",
      `\t- ${ago(50)} x`,
      "- [ ] B ^it-bbb1",
      `\t- ${ago(5)} x`,
      "- [ ] C ^it-ccc1",
      `\t- ${ago(10)} x`
    ]);
    const r = rollup(ws, now);
    expect(r.heat.ageMs).toBe(5 * HOUR);
    expect(r.heat.state).toBe("hot");
  });

  it("ignores done items", () => {
    const ws = workstream(["- [x] A ^it-aaa1", `\t- ${ago(1)} x`, "- [ ] B ^it-bbb1", `\t- ${ago(80)} x`]);
    expect(rollup(ws, now).heat.state).toBe("cold");
  });

  it("ignores terminal items", () => {
    const ws = workstream(["- [ ] A: *Released* ^it-aaa1", `\t- ${ago(1)} x`, "- [ ] B ^it-bbb1", `\t- ${ago(80)} x`]);
    expect(rollup(ws, now).heat.ageMs).toBe(80 * HOUR);
  });

  it("does not let parked or unknown items beat an item with an age", () => {
    const ws = workstream([
      "- [ ] A ^it-aaa1",
      "\t- **Wait** @2026-11-05",
      "- [ ] B ^it-bbb1",
      "\t- **Plan**",
      "- [ ] C ^it-ccc1",
      `\t- ${ago(100)} x`
    ]);
    expect(rollup(ws, now).heat.state).toBe("cold");
  });

  it("returns parked when nothing has an age", () => {
    const ws = workstream(["- [ ] A ^it-aaa1", "\t- **Plan**", "- [ ] B ^it-bbb1", "\t- **Wait** @2026-11-05"]);
    expect(rollup(ws, now).heat).toEqual({ state: "parked", parkedUntil: { date: "2026-11-05" } });
  });

  it("returns unknown when no open item has a timestamp", () => {
    const ws = workstream(["- [ ] A ^it-aaa1", "\t- **Plan**", "- [x] B ^it-bbb1", `\t- ${ago(1)} x`]);
    expect(rollup(ws, now).heat).toEqual({ state: "unknown" });
  });

  it("treats an empty workstream as done and unknown", () => {
    const empty: Workstream = { kind: "workstream", format: { indent: "", marker: "-" }, name: "E", children: [] };
    expect(rollup(empty, now)).toEqual({ lane: "done", heat: { state: "unknown" } });
  });

  it("orders lanes now, later, done", () => {
    const mixed = workstream(["- [x] A ^it-aaa1", "- [>] B ^it-bbb1", "- [ ] C ^it-ccc1"]);
    expect(rollup(mixed, now).lane).toBe("now");
    const later = workstream(["- [x] A ^it-aaa1", "- [>] B ^it-bbb1"]);
    expect(rollup(later, now).lane).toBe("later");
    const done = workstream(["- [x] A ^it-aaa1", "- [x] B ^it-bbb1"]);
    expect(rollup(done, now).lane).toBe("done");
  });

  it("rolls up the canonical workstream", () => {
    const doc = parse(canonical, { today: "2026-11-01" });
    const r = rollup(findWorkstream(doc, "ws-k3f2")!, now);
    expect(r.lane).toBe("now");
    expect(r.heat.state).toBe("parked");
  });
});

describe("formatAge", () => {
  it("formats minutes, hours and days", () => {
    expect(formatAge(3 * 60_000)).toBe("3 min");
    expect(formatAge(59 * 60_000 + 59_000)).toBe("59 min");
    expect(formatAge(HOUR)).toBe("1 h");
    expect(formatAge(2 * HOUR)).toBe("2 h");
    expect(formatAge(47 * HOUR + 59 * 60_000)).toBe("47 h");
    expect(formatAge(48 * HOUR)).toBe("2 d");
    expect(formatAge(4 * 24 * HOUR + 5 * HOUR)).toBe("4 d");
  });
});
