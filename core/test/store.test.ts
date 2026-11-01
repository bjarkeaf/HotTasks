import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, nodeFileSystem, withDefaults, setLane, items, findItem } from "../src/index.js";

const canonical = readFileSync(join(__dirname, "fixtures", "canonical.md"), "utf8");
const now = () => new Date(2026, 10, 1, 10, 12);

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "hottasks-"));
  writeFileSync(join(folder, "tasks.md"), canonical);
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("Store", () => {
  it("opens an existing folder", async () => {
    const store = await Store.open(withDefaults({ folder }), nodeFileSystem, now);
    expect([...items(store.doc)]).toHaveLength(5);
    expect(store.archiveText).toBe("");
  });

  it("opens an empty folder without files", async () => {
    rmSync(join(folder, "tasks.md"));
    const store = await Store.open(withDefaults({ folder }), nodeFileSystem, now);
    expect(store.doc.nodes).toEqual([]);
    await store.save();
    expect(existsSync(join(folder, "tasks.md"))).toBe(true);
  });

  it("saves after an operation and takes one snapshot per day", async () => {
    const store = await Store.open(withDefaults({ folder }), nodeFileSystem, now);
    setLane(store.doc, "it-7x1a", "later", now());
    await store.save();
    const text = readFileSync(join(folder, "tasks.md"), "utf8");
    expect(text).toContain("- [>] Lab PCs ^it-7x1a");
    expect(text).toContain("\t- @2026-11-01 10:12 Lane: Later");
    const snap = join(folder, "history", "tasks-2026-11-01.md");
    expect(readFileSync(snap, "utf8")).toBe(canonical);
    setLane(store.doc, "it-7x1a", "now", now());
    await store.save();
    expect(readFileSync(snap, "utf8")).toBe(canonical);
  });

  it("assigns ids on save", async () => {
    writeFileSync(join(folder, "tasks.md"), "- Fresh\n\t- [ ] Child\n- [ ] Alone\n");
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    await store.save();
    const text = readFileSync(join(folder, "tasks.md"), "utf8");
    expect(text).toMatch(/^- Fresh \^ws-[a-z0-9]{4}\n\t- \[ \] Child \^it-[a-z0-9]{4}\n- \[ \] Alone \^it-[a-z0-9]{4}\n$/);
  });

  it("notifies listeners on save", async () => {
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    const seen: string[] = [];
    store.onChange((_doc, source) => seen.push(source));
    await store.save();
    expect(seen).toEqual(["save"]);
  });

  it("reloads when the file changed on disk", async () => {
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    const seen: string[] = [];
    store.onChange((_doc, source) => seen.push(source));
    expect(await store.reloadIfChanged()).toBe(false);
    const path = join(folder, "tasks.md");
    writeFileSync(path, canonical + "- [ ] Added by hand ^it-zzzz\n");
    const future = new Date(Date.now() + 5000);
    utimesSync(path, future, future);
    expect(await store.reloadIfChanged()).toBe(true);
    expect(findItem(store.doc, "it-zzzz")?.item.name).toBe("Added by hand");
    expect(seen).toEqual(["disk"]);
  });

  it("renames in the live file and the archive", async () => {
    writeFileSync(join(folder, "tasks-archive.md"), "## 2026-10-30\n\n### it-7x1a Lab PCs\n- @2026-10-10 09:00 Old event\n");
    const store = await Store.open(withDefaults({ folder, snapshots: false }), nodeFileSystem, now);
    await store.rename("it-7x1a", "Lab computers");
    expect(readFileSync(join(folder, "tasks.md"), "utf8")).toContain("- [ ] Lab computers ^it-7x1a");
    expect(readFileSync(join(folder, "tasks-archive.md"), "utf8")).toContain("### it-7x1a Lab computers");
  });

  it("sweeps done items into the archive and writes both files", async () => {
    const store = await Store.open(withDefaults({ folder, snapshots: false, keepEvents: 3 }), nodeFileSystem, now);
    const result = await store.sweep();
    expect(result.archivedItems).toEqual(["it-5h1n"]);
    const tasks = readFileSync(join(folder, "tasks.md"), "utf8");
    expect(tasks).not.toContain("NPR63512");
    const archive = readFileSync(join(folder, "tasks-archive.md"), "utf8");
    expect(archive).toContain("## 2026-11-01");
    expect(archive).toContain("### it-5h1n NPR63512 (D-sub 15 connector)");
    expect(store.history("it-5h1n").map((e) => e.text)).toEqual(["Status: Released", "Done", "Archived"]);
  });
});
