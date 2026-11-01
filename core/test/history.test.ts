import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, sweep, history, currentName } from "../src/index.js";

const canonical = readFileSync(join(__dirname, "fixtures", "canonical.md"), "utf8");
const today = "2026-11-01";
const swept = sweep(parse(canonical, { today }), "", { today, keepEvents: 2 });

describe("history", () => {
  it("merges archive and live events oldest to newest", () => {
    const events = history(swept.doc, swept.archiveText, "it-9q7d");
    expect(events.map((e) => [e.source, e.at, e.text])).toEqual([
      ["archive", { date: "2026-10-13", time: "13:30" }, "Reminded Alex"],
      ["live", { date: "2026-10-15", time: "15:17" }, "Sam reminded to sign for Change_Analyst"],
      ["live", { date: "2026-10-15", time: "15:17" }, "Auto Teams reply to Alex Sunday 08:00"]
    ]);
  });

  it("reads a fully archived item", () => {
    const events = history(swept.doc, swept.archiveText, "it-5h1n");
    expect(events.map((e) => e.text)).toEqual(["Status: Released", "Done", "Archived"]);
    expect(events.every((e) => e.source === "archive")).toBe(true);
  });

  it("sorts by time even when sources interleave, ties in encounter order", () => {
    const doc = parse("- [ ] A ^it-aaaa\n\t- @2026-10-10 10:00 live early\n\t- @2026-10-12 10:00 live late\n");
    const arch = "## 2026-11-01\n\n### it-aaaa A\n- @2026-10-11 10:00 archived mid\n- @2026-10-10 10:00 archived tie\n";
    expect(history(doc, arch, "it-aaaa").map((e) => e.text)).toEqual(["archived tie", "live early", "archived mid", "live late"]);
  });

  it("is empty for an unknown id", () => {
    expect(history(swept.doc, swept.archiveText, "it-zzzz")).toEqual([]);
  });
});

describe("currentName", () => {
  it("prefers the live name", () => {
    expect(currentName(swept.doc, swept.archiveText, "it-9q7d")).toBe("MCO-042063");
  });

  it("falls back to the newest archived name once the item is gone", () => {
    expect(currentName(swept.doc, swept.archiveText, "it-5h1n")).toBe("NPR63512");
    const arch = "## 2026-10-01\n\n### it-aaaa Old name\n- x\n\n## 2026-10-02\n\n### it-aaaa New name\n- y\n";
    expect(currentName(parse(""), arch, "it-aaaa")).toBe("New name");
    expect(currentName(parse(""), arch, "it-zzzz")).toBeUndefined();
  });
});
