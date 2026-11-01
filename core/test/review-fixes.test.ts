import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, StoreConflict, nodeFileSystem, withDefaults, parse, serialize, items, findItem, findWorkstream, ensureIds, setLane, setStatus, addWorkstream, touch } from "../src/index.js";

describe("parser edge cases", () => {
  it("keeps a blank line inside an item without splitting it", () => {
    const text = "- [ ] A ^it-aaaa\n\t- f1\n\n\t- f2\n\t- @2026-10-01 10:00 e\n";
    const doc = parse(text);
    expect([...items(doc)]).toHaveLength(1);
    expect(serialize(doc)).toBe(text);
  });

  it("keeps a blank line between a workstream's items", () => {
    const text = "- WS ^ws-aaaa\n\t- [ ] A ^it-aaaa\n\n\t- [ ] B ^it-bbbb\n";
    const doc = parse(text);
    expect(findWorkstream(doc, "ws-aaaa")!.children.filter((c) => c.kind === "item")).toHaveLength(2);
    expect(serialize(doc)).toBe(text);
  });

  it("keeps a checkbox nested under an item as text", () => {
    const text = "- [ ] A ^it-aaaa\n\t- [x] done thing\n\t- @2026-10-01 10:00 ev\n\t- [ ] sub ^it-bbbb\n";
    const doc = parse(text);
    expect([...items(doc)]).toHaveLength(1);
    expect(serialize(doc)).toBe(text);
  });

  it("does not lose a character on a CRLF file with a bare LF ending", () => {
    const text = "- [ ] A ^it-aaaa\r\n\t- last note\n";
    expect(serialize(parse(text))).toBe("- [ ] A ^it-aaaa\r\n\t- last note\r\n");
  });

  it("accepts an empty checkbox line and an empty name with an id", () => {
    expect(serialize(parse("- [ ]\n"))).toBe("- [ ]\n");
    const doc = parse("- [ ] ^it-aaaa\n");
    expect(findItem(doc, "it-aaaa")?.item.name).toBe("");
    expect(serialize(doc)).toBe("- [ ] ^it-aaaa\n");
  });

  it("keeps an empty workstream a workstream through its id", () => {
    const doc = parse("");
    addWorkstream(doc, "Proj", new Set());
    const text = serialize(doc);
    const again = parse(text);
    expect(again.nodes[0]!.kind).toBe("workstream");
  });

  it("lets a [ ] under a Later heading mean Now once it has a checkbox", () => {
    const doc = parse("## Later\n\n- [>] A ^it-aaaa\n");
    setLane(doc, "it-aaaa", "now", new Date(2026, 10, 1, 9, 0));
    const text = serialize(doc);
    expect(findItem(parse(text), "it-aaaa")!.item.lane).toBe("now");
  });

  it("keeps loose text under an item line in place", () => {
    const text = "- [ ] A ^it-aaaa\n  some note\n\t- **Do**\n";
    expect(serialize(parse(text))).toBe(text);
  });

  it("strips asterisks from a status so the line stays parseable", () => {
    const doc = parse("- [ ] A ^it-aaaa\n");
    setStatus(doc, "it-aaaa", "Q*A", new Date(2026, 10, 1, 9, 0));
    expect(findItem(parse(serialize(doc)), "it-aaaa")!.item.status).toBe("QA");
  });

  it("does not reuse an archived id", () => {
    const doc = parse("- [ ] New\n");
    const seq = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    ensureIds(doc, () => seq[i++ % seq.length]!, ["it-aaaa"]);
    expect([...items(doc)][0]!.item.id).toBe("it-ssss");
  });
});

describe("store safety", () => {
  const now = () => new Date(2026, 10, 1, 10, 12);
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "hottasks-"));
    writeFileSync(join(folder, "tasks.md"), "- [ ] A ^it-aaaa\n\t- **Do**\n");
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  function bump(path: string) {
    const future = new Date(Date.now() + 5000 + Math.random() * 1000);
    utimesSync(path, future, future);
  }

  it("refuses to overwrite a hand edit and reloads instead", async () => {
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    const path = join(folder, "tasks.md");
    writeFileSync(path, "- [ ] A ^it-aaaa\n\t- **Do**\n- [ ] Hand ^it-hhhh\n");
    bump(path);
    touch(store.doc, "it-aaaa", now());
    await expect(store.save()).rejects.toBeInstanceOf(StoreConflict);
    expect(findItem(store.doc, "it-hhhh")).toBeDefined();
    expect(readFileSync(path, "utf8")).toContain("Hand");
    touch(store.doc, "it-aaaa", now());
    await store.save();
    expect(readFileSync(path, "utf8")).toContain("Touched");
    expect(readFileSync(path, "utf8")).toContain("Hand");
  });

  it("writes the lane and status events for hand edits on reload", async () => {
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    const path = join(folder, "tasks.md");
    writeFileSync(path, "- [x] A: *Released* ^it-aaaa\n\t- **Do**\n");
    bump(path);
    expect(await store.reloadIfChanged()).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("\t- @2026-11-01 10:12 Done\n");
    expect(text).toContain("\t- @2026-11-01 10:12 Status: Released\n");
  });

  it("runs the sweep once per day on save", async () => {
    writeFileSync(join(folder, "tasks.md"), "- [x] Old ^it-oooo\n\t- @2026-10-20 09:00 Done\n- [ ] A ^it-aaaa\n");
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    await store.save();
    expect(readFileSync(join(folder, "tasks.md"), "utf8")).not.toContain("Old");
    expect(readFileSync(join(folder, "tasks-archive.md"), "utf8")).toContain("### it-oooo Old");
  });
});
