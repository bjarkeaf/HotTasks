import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parse,
  serialize,
  findItem,
  addEvent,
  addInfo,
  addTask,
  completeTask,
  editTask,
  removeTask,
  reopenTask,
  setInfo,
  addItem,
  addWorkstream,
  ensureIds,
  importBullet,
  move,
  moveItemAfter,
  moveWorkstream,
  moveWorkstreamAfter,
  rename,
  setLane,
  setStatus,
  touch,
  items,
  usedIds
} from "../src/index.js";

const canonical = readFileSync(join(__dirname, "fixtures", "canonical.md"), "utf8");
const NOW = new Date(2026, 10, 1, 10, 12);
const STAMP = "2026-11-01 10:12";

function load() {
  return parse(canonical, { today: "2026-11-01" });
}

function lines(doc: ReturnType<typeof load>): string[] {
  return serialize(doc).split("\n");
}

describe("setLane", () => {
  it("changes the checkbox and appends the event", () => {
    const doc = load();
    setLane(doc, "it-9q7d", "later", NOW);
    const expected = canonical
      .replace("\t- [ ] MCO-042063", "\t- [>] MCO-042063")
      .replace(
        "\t\t- Auto Teams reply to Alex Sunday 08:00\n",
        `\t\t- Auto Teams reply to Alex Sunday 08:00\n\t\t- @${STAMP} Lane: Later\n`
      );
    expect(serialize(doc)).toBe(expected);
  });

  it("writes Lane: Now and Done", () => {
    const doc = load();
    setLane(doc, "it-2m8c", "now", NOW);
    setLane(doc, "it-7x1a", "done", NOW);
    const out = serialize(doc);
    expect(out).toContain(`\t\t- @${STAMP} Lane: Now\n`);
    expect(out).toContain(`\t- @${STAMP} Done\n`);
    expect(out).toContain("- [x] Lab PCs ^it-7x1a\n");
  });

  it("writes no event when the lane is unchanged", () => {
    const doc = load();
    setLane(doc, "it-9q7d", "now", NOW);
    expect(serialize(doc)).toBe(canonical);
  });
});

describe("setStatus", () => {
  it("sets the status and appends the event", () => {
    const doc = load();
    setStatus(doc, "it-2m8c", "Waiting", NOW);
    const expected = canonical
      .replace("[>] Alternative parts ^it-2m8c", "[>] Alternative parts: *Waiting* ^it-2m8c")
      .replace(
        "\t\t\t- Email thread from 2026-10-13\n",
        `\t\t\t- Email thread from 2026-10-13\n\t\t- @${STAMP} Status: Waiting\n`
      );
    expect(serialize(doc)).toBe(expected);
  });

  it("writes no event when the status is unchanged", () => {
    const doc = load();
    setStatus(doc, "it-9q7d", "QA Review", NOW);
    expect(serialize(doc)).toBe(canonical);
  });

  it("clears the status on undefined or empty text without an event", () => {
    const doc = load();
    setStatus(doc, "it-9q7d", undefined, NOW);
    const out = serialize(doc);
    expect(out).toContain("\t- [ ] MCO-042063 ^it-9q7d\n");
    expect(out).not.toContain(STAMP);
    const doc2 = load();
    setStatus(doc2, "it-9q7d", "", NOW);
    expect(serialize(doc2)).toBe(out);
  });
});

describe("addEvent and touch", () => {
  it("appends an event at now by default", () => {
    const doc = load();
    const ev = addEvent(doc, "it-7x1a", "Called Brian", undefined, NOW);
    expect(ev.at).toEqual({ date: "2026-11-01", time: "10:12" });
    expect(serialize(doc)).toContain(`\t- @2026-10-14 08:00 Request sent on Teams\n\t- @${STAMP} Called Brian\n`);
  });

  it("accepts an explicit Timestamp or Date", () => {
    const doc = load();
    addEvent(doc, "it-7x1a", "A", { date: "2026-10-20", time: "09:00" }, NOW);
    addEvent(doc, "it-7x1a", "B", new Date(2026, 9, 21, 7, 5), NOW);
    const out = serialize(doc);
    expect(out).toContain("\t- @2026-10-20 09:00 A\n");
    expect(out).toContain("\t- @2026-10-21 07:05 B\n");
  });

  it("touch appends a Touched event", () => {
    const doc = load();
    touch(doc, "it-7x1a", NOW);
    expect(serialize(doc)).toContain(`\t- @${STAMP} Touched\n`);
  });
});

describe("addInfo", () => {
  it("inserts after the existing info and above the first event", () => {
    const doc = load();
    addInfo(doc, "it-9q7d", "Owner is Alex");
    const expected = canonical.replace(
      "\t\t- Needs 'NPR released in PDP' set before it can promote\n",
      "\t\t- Needs 'NPR released in PDP' set before it can promote\n\t\t- Owner is Alex\n"
    );
    expect(serialize(doc)).toBe(expected);
  });

  it("works on an item with no children, deriving the format", () => {
    const doc = load();
    addInfo(doc, "it-0a0a", "Bookmarks live in Edge");
    expect(serialize(doc)).toContain("- [>] Clean up Agile bookmarks ^it-0a0a\n\t- Bookmarks live in Edge\n");
  });
});

describe("addTask", () => {
  it("creates a task above the events when the item has only events", () => {
    const doc = load();
    const task = addTask(doc, "it-5h1n", "Archive it");
    expect(task.text).toBe("Archive it");
    const expected = canonical.replace(
      "\t- [x] NPR63512: *Released* ^it-5h1n\n",
      "\t- [x] NPR63512: *Released* ^it-5h1n\n\t\t- **Archive it**\n"
    );
    expect(serialize(doc)).toBe(expected);
  });

  it("writes a not-before date", () => {
    const doc = load();
    addTask(doc, "it-5h1n", "Archive it", { date: "2026-11-05" });
    expect(serialize(doc)).toContain("\t\t- **Archive it** @2026-11-05\n");
  });

  it("appends after existing tasks and copies their format", () => {
    const doc = parse("- [ ] A ^it-aaaa\n\t* **Old**\n\t\t- sub\n\t- note\n", { today: "2026-11-01" });
    addTask(doc, "it-aaaa", "New");
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n\t* **Old**\n\t\t- sub\n\t* **New**\n\t- note\n");
  });

  it("derives space indentation from the item line", () => {
    const doc = parse("  - [ ] A ^it-aaaa\n", { today: "2026-11-01" });
    addTask(doc, "it-aaaa", "Do");
    expect(serialize(doc)).toBe("  - [ ] A ^it-aaaa\n    - **Do**\n");
  });
});

describe("editTask", () => {
  const two = "- [ ] A ^it-aaaa\n\t* **One** @2026-11-05\n\t\t- sub\n\t* **Two**\n";

  it("replaces the text and keeps format and children", () => {
    const doc = parse(two, { today: "2026-11-01" });
    editTask(doc, "it-aaaa", 1, "Second");
    expect(serialize(doc)).toBe(two.replace("**Two**", "**Second**"));
  });

  it("clears the date when omitted and sets it when given", () => {
    const doc = parse(two, { today: "2026-11-01" });
    editTask(doc, "it-aaaa", 0, "One");
    expect(serialize(doc)).toBe(two.replace(" @2026-11-05", ""));
    editTask(doc, "it-aaaa", 1, "Two", { date: "2026-12-01" });
    expect(serialize(doc)).toContain("\t* **Two** @2026-12-01\n");
  });

  it("removes the task on empty text", () => {
    const doc = parse(two, { today: "2026-11-01" });
    expect(editTask(doc, "it-aaaa", 0, "  ")).toBeUndefined();
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n\t* **Two**\n");
  });

  it("throws on a missing task", () => {
    const doc = parse(two, { today: "2026-11-01" });
    expect(() => editTask(doc, "it-aaaa", 5, "x")).toThrow("Task not found");
  });
});

describe("removeTask", () => {
  it("removes one task and writes no event", () => {
    const doc = load();
    removeTask(doc, "it-9q7d", 0);
    const out = serialize(doc);
    expect(out).not.toContain("Follow up with Alex");
    expect(out).toContain("\t- [ ] MCO-042063: *QA Review* ^it-9q7d\n\t\t- Needs 'NPR");
    expect(findItem(doc, "it-9q7d")!.item.events).toHaveLength(3);
  });
});

describe("completeTask and reopenTask", () => {
  const text = "- [ ] A ^it-aaaa\n\t- **One**\n\t\t- sub\n\t- **Two**\n\t- @2026-10-01 09:00 Started\n";

  it("moves the task into a Done event, keeping its sub-lines", () => {
    const doc = parse(text, { today: "2026-11-01" });
    const ev = completeTask(doc, "it-aaaa", 0, NOW);
    expect(ev.text).toBe("Done: One");
    expect(serialize(doc)).toBe(
      `- [ ] A ^it-aaaa\n\t- **Two**\n\t- @2026-10-01 09:00 Started\n\t- @${STAMP} Done: One\n\t\t- sub\n`
    );
  });

  it("reopening restores the same task text", () => {
    const doc = parse(text, { today: "2026-11-01" });
    completeTask(doc, "it-aaaa", 0, NOW);
    const task = reopenTask(doc, "it-aaaa", 1);
    expect(task.text).toBe("One");
    const item = findItem(doc, "it-aaaa")!.item;
    expect(item.tasks.map((t) => t.text)).toEqual(["Two", "One"]);
    expect(item.tasks[1]!.children).toEqual(["\t\t- sub"]);
    expect(item.events.map((e) => e.text)).toEqual(["Started"]);
  });

  it("keeps the stamp of a following lazy event when the Done event goes", () => {
    const doc = parse("- [ ] A ^it-aaaa\n\t- @2026-10-01 09:00 Done: One\n\t- lazy\n", { today: "2026-11-01" });
    reopenTask(doc, "it-aaaa", 0);
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n\t- **One**\n\t- @2026-10-01 09:00 lazy\n");
  });

  it("throws when the event is not a Done event", () => {
    const doc = parse(text, { today: "2026-11-01" });
    expect(() => reopenTask(doc, "it-aaaa", 0)).toThrow("Not a Done event");
    expect(() => reopenTask(doc, "it-aaaa", 9)).toThrow("Not a Done event");
  });
});

describe("setInfo", () => {
  it("replaces lines, keeping formats and sub-lines of the first ones", () => {
    const doc = parse("- [ ] A ^it-aaaa\n\t* **Do**\n\t* one\n\t\t- sub\n\t* two\n\t\t- gone\n", { today: "2026-11-01" });
    setInfo(doc, "it-aaaa", ["uno"]);
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n\t* **Do**\n\t* uno\n\t\t- sub\n");
  });

  it("derives the format for extra lines and can clear all lines", () => {
    const doc = parse("- [ ] A ^it-aaaa\n\t* **Do**\n", { today: "2026-11-01" });
    setInfo(doc, "it-aaaa", ["a", "b"]);
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n\t* **Do**\n\t* a\n\t* b\n");
    setInfo(doc, "it-aaaa", []);
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n\t* **Do**\n");
  });
});

describe("rename", () => {
  it("renames an item and a workstream", () => {
    const doc = load();
    rename(doc, "it-7x1a", "Lab PCs and monitors");
    rename(doc, "ws-k3f2", "Molex D-sub 15");
    const out = serialize(doc);
    expect(out).toContain("- [ ] Lab PCs and monitors ^it-7x1a\n");
    expect(out).toContain("- Molex D-sub 15 ^ws-k3f2\n");
  });
});

describe("addItem", () => {
  it("appends at top level", () => {
    const doc = load();
    const item = addItem(doc, "Lab tools");
    expect(item.id).toMatch(/^it-[a-z0-9]{4}$/);
    expect(serialize(doc)).toBe(`${canonical}- [ ] Lab tools ^${item.id}\n`);
  });

  it("appends under a workstream copying a sibling's format", () => {
    const doc = load();
    const item = addItem(doc, "Plating spec", { parentId: "ws-k3f2", lane: "later", status: "Draft" });
    const expected = canonical.replace(
      "\t\t- @2026-10-31 16:02 Done\n",
      `\t\t- @2026-10-31 16:02 Done\n\t- [>] Plating spec: *Draft* ^${item.id}\n`
    );
    expect(serialize(doc)).toBe(expected);
  });

  it("derives the format from an empty workstream", () => {
    const doc = parse("* [ ] A ^it-aaaa\n", { today: "2026-11-01" });
    const ws = addWorkstream(doc, "Empty");
    const item = addItem(doc, "First", { parentId: ws.id });
    expect(serialize(doc)).toBe(`* [ ] A ^it-aaaa\n* Empty ^${ws.id}\n\t* [ ] First ^${item.id}\n`);
  });

  it("uses a given id set and never reuses ids", () => {
    const doc = load();
    const ids = usedIds(doc);
    const a = addItem(doc, "A", { ids });
    const b = addItem(doc, "B", { ids });
    expect(a.id).not.toBe(b.id);
    expect(ids.has(a.id!)).toBe(true);
  });

  it("copies the top-level marker of the document", () => {
    const doc = parse("* [ ] A ^it-aaaa\n", { today: "2026-11-01" });
    const item = addItem(doc, "B");
    expect(serialize(doc)).toBe(`* [ ] A ^it-aaaa\n* [ ] B ^${item.id}\n`);
  });

  it("throws when the parent is not a workstream", () => {
    expect(() => addItem(load(), "X", { parentId: "it-7x1a" })).toThrow(/Workstream not found: it-7x1a/);
  });
});

describe("addWorkstream", () => {
  it("creates a workstream at the end with a ws id", () => {
    const doc = load();
    const ws = addWorkstream(doc, "Paddle card");
    expect(ws.id).toMatch(/^ws-[a-z0-9]{4}$/);
    expect(serialize(doc)).toBe(`${canonical}- Paddle card ^${ws.id}\n`);
  });
});

describe("move", () => {
  it("moves a top-level item into a workstream and indents its lines", () => {
    const doc = load();
    move(doc, "it-7x1a", "ws-k3f2", 0);
    const out = lines(doc);
    const at = out.indexOf("\t- [ ] Lab PCs ^it-7x1a");
    expect(at).toBe(out.indexOf("- D-sub 15 connector ^ws-k3f2") + 1);
    expect(out.slice(at, at + 3)).toEqual([
      "\t- [ ] Lab PCs ^it-7x1a",
      "\t\t- **Follow up with Brian in person**",
      "\t\t- @2026-10-14 08:00 Request sent on Teams"
    ]);
    expect(out).not.toContain("- [ ] Lab PCs ^it-7x1a");
  });

  it("moves a workstream item to top level and strips one indent level", () => {
    const doc = load();
    move(doc, "it-2m8c", undefined, 999);
    const out = serialize(doc);
    expect(out.endsWith(
      "- [>] Clean up Agile bookmarks ^it-0a0a\n" +
        "- [>] Alternative parts ^it-2m8c\n" +
        "\t- **Check if LO matches between Vendor B and Molex**\n" +
        "\t- Alex: Vendor A out, Vendor B potential 2nd source\n" +
        "\t\t- Email thread from 2026-10-13\n"
    )).toBe(true);
    expect(findItem(doc, "it-2m8c")?.workstream).toBeUndefined();
  });

  it("reorders within a workstream", () => {
    const doc = load();
    move(doc, "it-5h1n", "ws-k3f2", 0);
    const names = [...items(doc)].map((e) => e.item.id);
    expect(names).toEqual(["it-5h1n", "it-9q7d", "it-2m8c", "it-7x1a", "it-0a0a"]);
  });

  it("round trips after a move", () => {
    const doc = load();
    move(doc, "it-7x1a", "ws-k3f2", 1);
    const once = serialize(doc);
    expect(serialize(parse(once, { today: "2026-11-01" }))).toBe(once);
  });

  it("throws for unknown ids, a non-workstream parent, or a workstream id", () => {
    const doc = load();
    expect(() => move(doc, "it-nope", undefined, 0)).toThrow(/Item not found/);
    expect(() => move(doc, "it-7x1a", "it-9q7d", 0)).toThrow(/Workstream not found/);
    expect(() => move(doc, "ws-k3f2", undefined, 0)).toThrow(/Item not found/);
  });
});

const TWO = [
  "# Tasks",
  "",
  "- Alpha ^ws-aaaa",
  "\t- [ ] One ^it-0001",
  "\t\t- @2026-10-01 09:00 Made",
  "\t- [ ] Two ^it-0002",
  "- Beta ^ws-bbbb",
  "\t- [ ] Three ^it-0003",
  "- Gamma ^ws-cccc",
  "\t- [ ] Four ^it-0004",
  ""
].join("\n");

function two() {
  return parse(TWO, { today: "2026-11-01" });
}

describe("moveItemAfter", () => {
  it("reorders within a workstream", () => {
    const doc = two();
    moveItemAfter(doc, "it-0001", "ws-aaaa", "it-0002");
    expect(serialize(doc)).toBe(
      TWO.replace(
        "\t- [ ] One ^it-0001\n\t\t- @2026-10-01 09:00 Made\n\t- [ ] Two ^it-0002\n",
        "\t- [ ] Two ^it-0002\n\t- [ ] One ^it-0001\n\t\t- @2026-10-01 09:00 Made\n"
      )
    );
  });

  it("puts the item first when afterId is null", () => {
    const doc = two();
    moveItemAfter(doc, "it-0002", "ws-aaaa", null);
    expect([...items(doc)].map((e) => e.item.id)).toEqual(["it-0002", "it-0001", "it-0003", "it-0004"]);
  });

  it("moves between workstreams and keeps the sub-lines indented", () => {
    const doc = two();
    moveItemAfter(doc, "it-0001", "ws-bbbb", "it-0003");
    expect(serialize(doc)).toBe(
      [
        "# Tasks",
        "",
        "- Alpha ^ws-aaaa",
        "\t- [ ] Two ^it-0002",
        "- Beta ^ws-bbbb",
        "\t- [ ] Three ^it-0003",
        "\t- [ ] One ^it-0001",
        "\t\t- @2026-10-01 09:00 Made",
        "- Gamma ^ws-cccc",
        "\t- [ ] Four ^it-0004",
        ""
      ].join("\n")
    );
  });

  it("moves to top level and back", () => {
    const doc = two();
    moveItemAfter(doc, "it-0002", undefined, null);
    expect(lines(doc).slice(0, 6)).toEqual(["# Tasks", "", "- [ ] Two ^it-0002", "- Alpha ^ws-aaaa", "\t- [ ] One ^it-0001", "\t\t- @2026-10-01 09:00 Made"]);
    moveItemAfter(doc, "it-0002", "ws-aaaa", "it-0001");
    expect(serialize(doc)).toBe(TWO);
  });

  it("does nothing when dropped after itself", () => {
    const doc = two();
    moveItemAfter(doc, "it-0001", "ws-aaaa", "it-0001");
    expect(serialize(doc)).toBe(TWO);
  });

  it("throws for unknown ids and siblings", () => {
    const doc = two();
    expect(() => moveItemAfter(doc, "it-nope", "ws-aaaa", null)).toThrow(/Item not found/);
    expect(() => moveItemAfter(doc, "it-0001", "ws-nope", null)).toThrow(/Workstream not found/);
    expect(() => moveItemAfter(doc, "it-0001", "ws-aaaa", "it-0003")).toThrow(/Sibling not found/);
    expect(() => moveItemAfter(doc, "ws-aaaa", undefined, null)).toThrow(/Item not found/);
  });
});

describe("moveWorkstream", () => {
  it("counts all top-level nodes, clamped", () => {
    const doc = two();
    moveWorkstream(doc, "ws-aaaa", 999);
    expect(serialize(doc)).toBe(
      "# Tasks\n\n- Beta ^ws-bbbb\n\t- [ ] Three ^it-0003\n- Gamma ^ws-cccc\n\t- [ ] Four ^it-0004\n- Alpha ^ws-aaaa\n\t- [ ] One ^it-0001\n\t\t- @2026-10-01 09:00 Made\n\t- [ ] Two ^it-0002\n"
    );
    moveWorkstream(doc, "ws-aaaa", 0);
    expect(lines(doc)[0]).toBe("- Alpha ^ws-aaaa");
  });

  it("throws for an item or unknown id", () => {
    const doc = two();
    expect(() => moveWorkstream(doc, "it-0001", 0)).toThrow(/Workstream not found/);
    expect(() => moveWorkstream(doc, "ws-nope", 0)).toThrow(/Workstream not found/);
  });
});

describe("moveWorkstreamAfter", () => {
  const order = (doc: ReturnType<typeof two>) => doc.nodes.flatMap((n) => (n.kind === "workstream" ? [n.id] : []));

  it("moves to first, middle and last", () => {
    const doc = two();
    moveWorkstreamAfter(doc, "ws-cccc", null);
    expect(order(doc)).toEqual(["ws-cccc", "ws-aaaa", "ws-bbbb"]);
    expect(serialize(doc).startsWith("# Tasks\n\n- Gamma ^ws-cccc\n\t- [ ] Four ^it-0004\n- Alpha")).toBe(true);
    moveWorkstreamAfter(doc, "ws-cccc", "ws-aaaa");
    expect(order(doc)).toEqual(["ws-aaaa", "ws-cccc", "ws-bbbb"]);
    moveWorkstreamAfter(doc, "ws-aaaa", "ws-bbbb");
    expect(order(doc)).toEqual(["ws-cccc", "ws-bbbb", "ws-aaaa"]);
  });

  it("keeps children and round trips", () => {
    const doc = two();
    moveWorkstreamAfter(doc, "ws-aaaa", "ws-cccc");
    const out = serialize(doc);
    expect(out).toBe(
      "# Tasks\n\n- Beta ^ws-bbbb\n\t- [ ] Three ^it-0003\n- Gamma ^ws-cccc\n\t- [ ] Four ^it-0004\n- Alpha ^ws-aaaa\n\t- [ ] One ^it-0001\n\t\t- @2026-10-01 09:00 Made\n\t- [ ] Two ^it-0002\n"
    );
    expect(serialize(parse(out, { today: "2026-11-01" }))).toBe(out);
  });

  it("does nothing when dropped after itself, throws for bad ids", () => {
    const doc = two();
    moveWorkstreamAfter(doc, "ws-bbbb", "ws-bbbb");
    expect(serialize(doc)).toBe(TWO);
    expect(() => moveWorkstreamAfter(doc, "it-0001", null)).toThrow(/Workstream not found/);
    expect(() => moveWorkstreamAfter(doc, "ws-aaaa", "it-0001")).toThrow(/Workstream not found/);
  });
});

describe("importBullet", () => {
  it("imports a multi-line bullet under a workstream and re-indents", () => {
    const doc = load();
    const item = importBullet(
      doc,
      "- Pinout question\n\t- **Ask vendor**\n\t- Datasheet rev C\n\t\t- see page 4\n\t- @09:30 Spoke to FAE\n",
      "ws-k3f2",
      { now: NOW }
    );
    expect(item.kind).toBe("item");
    const expected = canonical.replace(
      "\t\t- @2026-10-31 16:02 Done\n",
      "\t\t- @2026-10-31 16:02 Done\n" +
        `\t- [ ] Pinout question ^${item.id}\n` +
        "\t\t- **Ask vendor**\n" +
        "\t\t- Datasheet rev C\n" +
        "\t\t\t- see page 4\n" +
        "\t\t- @2026-11-01 09:30 Spoke to FAE\n"
    );
    expect(serialize(doc)).toBe(expected);
  });

  it("strips the source indentation when importing at top level", () => {
    const doc = load();
    const item = importBullet(doc, "\t\t- Foo\n\t\t\t- **Do it**\n\t\t\t- Context\n\t\t\t\t- more\n");
    expect(serialize(doc)).toBe(
      `${canonical}- [ ] Foo ^${item.id}\n\t- **Do it**\n\t- Context\n\t\t- more\n`
    );
  });

  it("imports a workstream whole at top level", () => {
    const doc = load();
    const ws = importBullet(doc, "\t- Paddle\n\t\t- [ ] ECO-1: *Review*\n\t\t\t- **Promote**\n\t\t- [>] Plate\n");
    expect(ws.kind).toBe("workstream");
    expect(serialize(doc)).toBe(
      `${canonical}- Paddle ^${ws.id}\n` +
        `\t- [ ] ECO-1: *Review* ^${(ws as { children: Array<{ id?: string }> }).children[0]!.id}\n` +
        "\t\t- **Promote**\n" +
        `\t- [>] Plate ^${(ws as { children: Array<{ id?: string }> }).children[1]!.id}\n`
    );
  });

  it("gives a fresh id when the pasted id is already in use", () => {
    const doc = load();
    const item = importBullet(doc, "- [ ] Dup ^it-7x1a\n");
    expect(item.id).not.toBe("it-7x1a");
    expect(item.id).toMatch(/^it-[a-z0-9]{4}$/);
  });

  it("throws when there is no bullet", () => {
    expect(() => importBullet(load(), "just text\n")).toThrow(/No bullet/);
  });
});

describe("ensureIds", () => {
  it("assigns missing ids, counts them, and keeps them unique", () => {
    const doc = parse("- WS\n\t- [ ] A\n\t- [ ] B\n- [ ] C\n- [ ] D ^it-aaaa\n", { today: "2026-11-01" });
    expect(ensureIds(doc)).toBe(4);
    const ids = [...usedIds(doc)];
    expect(ids).toHaveLength(5);
    for (const id of ids) expect(id).toMatch(/^(ws|it)-[a-z0-9]{4}$/);
    expect(ensureIds(doc)).toBe(0);
  });

  it("does nothing to a file that already has ids", () => {
    const doc = load();
    expect(ensureIds(doc)).toBe(0);
    expect(serialize(doc)).toBe(canonical);
  });

  it("retries on collisions", () => {
    const doc = parse("- [ ] A ^it-aaaa\n- [ ] B\n", { today: "2026-11-01" });
    const seq = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    ensureIds(doc, () => seq[i++]!);
    expect(serialize(doc)).toBe("- [ ] A ^it-aaaa\n- [ ] B ^it-ssss\n");
  });
});

describe("unknown ids", () => {
  it("throws a clear error", () => {
    const doc = load();
    expect(() => setLane(doc, "it-nope", "done")).toThrow("Item not found: it-nope");
    expect(() => setStatus(doc, "it-nope", "x")).toThrow("Item not found: it-nope");
    expect(() => addEvent(doc, "it-nope", "x")).toThrow("Item not found: it-nope");
    expect(() => touch(doc, "it-nope")).toThrow("Item not found: it-nope");
    expect(() => addTask(doc, "it-nope", "x")).toThrow("Item not found: it-nope");
    expect(() => addInfo(doc, "it-nope", "x")).toThrow("Item not found: it-nope");
    expect(() => rename(doc, "it-nope", "x")).toThrow("not found: it-nope");
  });
});
