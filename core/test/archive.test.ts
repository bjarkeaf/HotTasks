import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, serialize, parseArchive, serializeArchive, appendArchive, renameInArchive, sweep } from "../src/index.js";

const fixtures = join(__dirname, "fixtures");
const canonical = readFileSync(join(fixtures, "canonical.md"), "utf8");
const archive = readFileSync(join(fixtures, "archive.md"), "utf8");

describe("archive format", () => {
  it("parses days, items and workstreams", () => {
    const entries = parseArchive(archive);
    expect(entries.map((e) => [e.date, e.id, e.name, e.workstream])).toEqual([
      ["2026-10-20", "it-7x1a", "Lab PCs", undefined],
      ["2026-11-01", "it-5h1n", "NPR63512", "D-sub 15 connector"],
      ["2026-11-01", "it-9q7d", "MCO-042063", "D-sub 15 connector"]
    ]);
    expect(entries[1]!.lines).toHaveLength(4);
    expect(entries[1]!.lines[1]).toBe("\t- @2026-10-20 09:40 Status: Released");
  });

  it("round trips byte for byte", () => {
    expect(serializeArchive(parseArchive(archive))).toBe(archive);
  });
});

describe("appendArchive", () => {
  const entry = (date: string, id: string) => ({ date, id, name: "Thing", lines: ["- @2026-10-01 08:00 Pinged"] });

  it("creates the day heading when missing", () => {
    expect(appendArchive(archive, [entry("2026-11-02", "it-0a0a")])).toBe(
      archive + "\n## 2026-11-02\n\n### it-0a0a Thing\n- @2026-10-01 08:00 Pinged\n"
    );
  });

  it("starts a new file", () => {
    expect(appendArchive("", [entry("2026-11-02", "it-0a0a")])).toBe("## 2026-11-02\n\n### it-0a0a Thing\n- @2026-10-01 08:00 Pinged\n");
  });

  it("reuses an existing day heading, also when it is not last", () => {
    const out = appendArchive(archive, [entry("2026-10-20", "it-0a0a")]);
    expect(out).toBe(
      archive.replace(
        "Teams\n\n## 2026-11-01",
        "Teams\n\n### it-0a0a Thing\n- @2026-10-01 08:00 Pinged\n\n## 2026-11-01"
      )
    );
    expect(out.match(/^## 2026-10-20$/gm)).toHaveLength(1);
  });

  it("keeps existing content untouched when appending to the last day", () => {
    const out = appendArchive(archive, [entry("2026-11-01", "it-0a0a")]);
    expect(out).toBe(archive + "\n### it-0a0a Thing\n- @2026-10-01 08:00 Pinged\n");
  });
});

describe("renameInArchive", () => {
  it("renames every heading for the id and keeps the workstream", () => {
    const text = appendArchive(archive, [{ date: "2026-11-02", id: "it-5h1n", name: "NPR63512", workstream: "D-sub 15 connector", lines: ["- x"] }]);
    const out = renameInArchive(text, "it-5h1n", "NPR63512 v2");
    expect(out.match(/^### it-5h1n NPR63512 v2 \(D-sub 15 connector\)$/gm)).toHaveLength(2);
    expect(out).toContain("### it-7x1a Lab PCs\n");
    expect(out).toContain("### it-9q7d MCO-042063 (");
  });

  it("works without a workstream and leaves other text alone", () => {
    expect(renameInArchive(archive, "it-7x1a", "Lab machines")).toBe(archive.replace("Lab PCs", "Lab machines"));
    expect(renameInArchive(archive, "it-zzzz", "X")).toBe(archive);
  });
});

describe("sweep", () => {
  const today = "2026-11-01";

  it("archives done items and trims old events", () => {
    const doc = parse(canonical, { today });
    const res = sweep(doc, "", { today, keepEvents: 2 });
    expect(res.archivedItems).toEqual(["it-5h1n"]);
    expect(res.trimmedItems).toEqual(["it-9q7d"]);

    const expectedTasks = canonical
      .replace("\t- [x] NPR63512: *Released* ^it-5h1n\n\t\t- @2026-10-20 09:40 Status: Released\n\t\t- @2026-10-31 16:02 Done\n", "")
      .replace("\t\t- @2026-10-13 13:30 Reminded Alex\n", "");
    expect(expectedTasks).not.toBe(canonical);
    expect(serialize(res.doc)).toBe(expectedTasks);
    expect(serialize(res.doc)).toContain(
      "\t\t- @2026-10-15 15:17 Sam reminded to sign for Change_Analyst\n\t\t- Auto Teams reply to Alex Sunday 08:00\n\t- [>] Alternative parts"
    );

    expect(res.archiveText).toBe(
      [
        "## 2026-11-01",
        "",
        "### it-5h1n NPR63512 (D-sub 15 connector)",
        "- [x] NPR63512: *Released* ^it-5h1n",
        "\t- @2026-10-20 09:40 Status: Released",
        "\t- @2026-10-31 16:02 Done",
        "\t- @2026-11-01 00:00 Archived",
        "",
        "### it-9q7d MCO-042063 (D-sub 15 connector)",
        "- @2026-10-13 13:30 Reminded Alex",
        ""
      ].join("\n")
    );
  });

  it("does not modify the input document", () => {
    const doc = parse(canonical, { today });
    sweep(doc, "", { today, keepEvents: 1 });
    expect(serialize(doc)).toBe(canonical);
  });

  it("writes inherited timestamps in full and keeps the first kept event dated", () => {
    const doc = parse(canonical, { today });
    const res = sweep(doc, "", { today, keepEvents: 1 });
    expect(res.archiveText).toContain("- @2026-10-13 13:30 Reminded Alex\n- @2026-10-15 15:17 Sam reminded to sign for Change_Analyst\n");
    expect(serialize(res.doc)).toContain("\t\t- @2026-10-15 15:17 Auto Teams reply to Alex Sunday 08:00\n");
    expect(serialize(parse(serialize(res.doc))).length).toBe(serialize(res.doc).length);
  });

  it("does nothing when nothing is old enough", () => {
    const doc = parse(canonical, { today: "2026-10-31" });
    const res = sweep(doc, "", { today: "2026-10-31", keepEvents: 10 });
    expect(res.archivedItems).toEqual([]);
    expect(res.trimmedItems).toEqual([]);
    expect(res.archiveText).toBe("");
    expect(serialize(res.doc)).toBe(canonical);
  });

  it("only archives with a large keepEvents", () => {
    const res = sweep(parse(canonical, { today }), archive, { today, keepEvents: 10 });
    expect(res.archivedItems).toEqual(["it-5h1n"]);
    expect(res.trimmedItems).toEqual([]);
    expect(res.archiveText.startsWith(archive)).toBe(true);
  });

  it("keeps a done item whose Done event is dated today", () => {
    const text = "- [x] Fresh ^it-aaaa\n\t- @2026-11-01 09:00 Done\n";
    const res = sweep(parse(text, { today }), "", { today, keepEvents: 3 });
    expect(res.archivedItems).toEqual([]);
    expect(serialize(res.doc)).toBe(text);
  });

  it("archives done items without a Done event or without timestamps", () => {
    const text = "- [x] Old ^it-aaaa\n\t- @2026-10-01 09:00 Pinged\n- [x] Ancient ^it-bbbb\n\t- **Nothing**\n";
    const res = sweep(parse(text, { today }), "", { today, keepEvents: 3 });
    expect(res.archivedItems).toEqual(["it-aaaa", "it-bbbb"]);
    expect(res.doc.nodes).toEqual([]);
    expect(res.archiveText).toContain("### it-bbbb Ancient\n- [x] Ancient ^it-bbbb\n\t- **Nothing**\n\t- @2026-11-01 00:00 Archived\n");
  });

  it("keeps an emptied workstream", () => {
    const text = "- Proj ^ws-aaaa\n\t- [x] A ^it-aaaa\n\t\t- @2026-10-01 09:00 Done\n";
    const res = sweep(parse(text, { today }), "", { today, keepEvents: 3 });
    expect(serialize(res.doc)).toBe("- Proj ^ws-aaaa\n");
    expect(res.archiveText).toContain("### it-aaaa A (Proj)\n- [x] A ^it-aaaa\n\t- @2026-10-01 09:00 Done\n\t- @2026-11-01 00:00 Archived\n");
  });
});
