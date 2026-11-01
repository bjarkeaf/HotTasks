import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, serialize, items, findItem, findWorkstream } from "../src/index.js";

const fixtures = join(__dirname, "fixtures");
const canonical = readFileSync(join(fixtures, "canonical.md"), "utf8");

describe("parse canonical", () => {
  const doc = parse(canonical, { today: "2026-11-01" });

  it("finds workstreams and items", () => {
    const ws = findWorkstream(doc, "ws-k3f2");
    expect(ws?.name).toBe("Molex D-sub 15 - 065-1271-000");
    expect(ws?.children.filter((c) => c.kind === "item")).toHaveLength(3);
    expect([...items(doc)].map((e) => e.item.id)).toEqual(["it-9q7d", "it-2m8c", "it-5h1n", "it-7x1a", "it-0a0a"]);
  });

  it("reads lane from the checkbox", () => {
    expect(findItem(doc, "it-9q7d")?.item.lane).toBe("now");
    expect(findItem(doc, "it-2m8c")?.item.lane).toBe("later");
    expect(findItem(doc, "it-5h1n")?.item.lane).toBe("done");
  });

  it("reads status and name", () => {
    const it9 = findItem(doc, "it-9q7d")!.item;
    expect(it9.name).toBe("MCO-042063");
    expect(it9.status).toBe("QA Review");
    expect(findItem(doc, "it-2m8c")!.item.status).toBeUndefined();
  });

  it("reads task, facts and events in order", () => {
    const it9 = findItem(doc, "it-9q7d")!.item;
    expect(it9.task?.text).toBe("Follow up with Ronen");
    expect(it9.task?.notBefore).toEqual({ date: "2026-11-02" });
    expect(it9.facts.map((f) => f.text)).toEqual(["Needs 'NPR released in PDP' set before it can promote"]);
    expect(it9.events.map((e) => e.text)).toEqual([
      "Reminded Ronen",
      "Shani reminded to sign for T2P_Change_Analyst",
      "Auto Teams reply to Ronen Sunday 08:00"
    ]);
  });

  it("lazy events inherit the time above them", () => {
    const it9 = findItem(doc, "it-9q7d")!.item;
    const lazy = it9.events[2]!;
    expect(lazy.explicit).toBe(false);
    expect(lazy.at).toEqual({ date: "2026-10-15", time: "15:17" });
  });

  it("keeps sub-bullets under a fact verbatim", () => {
    const alt = findItem(doc, "it-2m8c")!.item;
    expect(alt.facts[0]!.children).toEqual(["\t\t\t- Email thread from 2026-10-13"]);
  });

  it("reads a top-level item with no workstream", () => {
    const lab = findItem(doc, "it-7x1a")!;
    expect(lab.workstream).toBeUndefined();
    expect(lab.item.task?.text).toBe("Follow up with Brian in person");
    expect(lab.item.events[0]!.at).toEqual({ date: "2026-10-14", time: "08:00" });
  });

  it("round trips byte for byte", () => {
    expect(serialize(doc)).toBe(canonical);
  });
});

describe("parse rules", () => {
  it("resolves a bare time to today and writes it in full", () => {
    const doc = parse("- [ ] Thing\n\t- @9:05 Pinged\n", { today: "2026-11-01" });
    const item = [...items(doc)][0]!.item;
    expect(item.events[0]!.at).toEqual({ date: "2026-11-01", time: "09:05" });
    expect(serialize(doc)).toBe("- [ ] Thing\n\t- @2026-11-01 09:05 Pinged\n");
  });

  it("takes lane from a heading only when the bullet has no checkbox", () => {
    const text = "## Task status\n- A\n### Not urgent tasks\n- B\n- [ ] B2\n### Done\n- C\n- [>] D\n";
    const doc = parse(text);
    expect([...items(doc)].map((e) => e.item.lane)).toEqual(["now", "later", "now", "done", "later"]);
    expect(serialize(doc)).toBe("## Task status\n- [ ] A\n### Not urgent tasks\n- [>] B\n- [ ] B2\n### Done\n- [x] C\n- [>] D\n");
  });

  it("treats a plain bullet with a bold child as an item and adds a checkbox", () => {
    const doc = parse("* Lab PCs\n\t* **Follow up**\n\t* Request sent\n");
    const item = [...items(doc)][0]!.item;
    expect(item.checkbox).toBe(false);
    expect(item.task?.text).toBe("Follow up");
    expect(item.facts.map((f) => f.text)).toEqual(["Request sent"]);
    expect(serialize(doc)).toBe("* [ ] Lab PCs\n\t* **Follow up**\n\t* Request sent\n");
  });

  it("treats a plain bullet whose children are item-like as a workstream", () => {
    const doc = parse("* Paddle\n\t* ECO-1: *Review*\n\t\t* **Promote**\n\t* Plate\n\t\t* Only preliminary\n");
    const ws = doc.nodes[0]!;
    expect(ws.kind).toBe("workstream");
    const kids = [...items(doc)];
    expect(kids.map((e) => e.item.name)).toEqual(["ECO-1", "Plate"]);
    expect(kids[0]!.item.status).toBe("Review");
    expect(kids[1]!.item.facts[0]!.text).toBe("Only preliminary");
  });

  it("keeps a second bold line as a fact", () => {
    const doc = parse("- [ ] A\n\t- **First**\n\t- **Second**\n");
    const item = [...items(doc)][0]!.item;
    expect(item.task?.text).toBe("First");
    expect(item.facts[0]!.text).toBe("**Second**");
  });

  it("preserves CRLF and a missing trailing newline", () => {
    const text = "- [ ] A\r\n\t- **Do**";
    expect(serialize(parse(text))).toBe(text);
  });

  it("keeps unknown lines in place", () => {
    const text = "Intro paragraph\n\n- [ ] A\n\n> quote\n";
    expect(serialize(parse(text))).toBe(text);
  });
});

describe("legacy notes", () => {
  const legacy = existsSync(fixtures) ? readdirSync(fixtures).filter((f) => f.startsWith("legacy-")) : [];
  if (legacy.length === 0) {
    it.skip("no legacy fixtures present", () => {});
  }
  it.each(legacy)("%s parses and is stable after one normalisation", (name) => {
    const text = readFileSync(join(fixtures, name), "utf8");
    const once = serialize(parse(text, { today: "2026-11-01" }));
    const twice = serialize(parse(once, { today: "2026-11-01" }));
    expect(twice).toBe(once);
    expect([...items(parse(once))].length).toBeGreaterThan(5);
  });
});
