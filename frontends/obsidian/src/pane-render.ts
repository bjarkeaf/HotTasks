import type { Item, Workstream } from "@hottasks/core";
import { addItem, findWorkstream, formatAge, itemHeat, items, rename, rollup, setLane, workstreams } from "@hottasks/core";
import type { Ctx } from "./pane-card";
import { buildCard } from "./pane-card";
import { removeEmptyWorkstream } from "./pane-actions";
import { dropZone, wsSource } from "./pane-drag";
import { LIMITS, closePop, confirmPopover, h, icon, inputPopover, liveEdit, popover } from "./pane-edit";
import { LANES, LANE_NAMES, wsHue, wsStyle } from "./pane-state";

interface Entry {
  item: Item;
  workstream?: Workstream;
}

const HUES = [0, 25, 45, 90, 150, 190, 215, 250, 290, 330];

function matches(entry: Entry, q: string): boolean {
  if (q === "") return true;
  const { item, workstream } = entry;
  const text = [item.name, item.status, workstream?.name, ...item.tasks.map((t) => t.text), ...item.info.map((i) => i.text)];
  return text.join(" ").toLowerCase().includes(q);
}

export function renderList(ctx: Ctx, list: HTMLElement): void {
  const { prefs } = ctx.host;
  const q = prefs.q.trim().toLowerCase();
  const doc = ctx.store.doc;
  const all = [...items(doc)].filter((e) => prefs.lanes.includes(e.item.lane) && matches(e, q));
  list.replaceChildren();
  const shown = LANES.filter((l) => prefs.lanes.includes(l));
  for (const lane of shown) {
    const vis = all.filter((e) => e.item.lane === lane);
    let into: HTMLElement = list;
    if (shown.length > 1) {
      const sec = h("section", `lanesec lane-${lane}`, undefined, list);
      const head = h("div", "lanehead", undefined, sec);
      h("span", "", LANE_NAMES[lane], head);
      h("span", "n", `${vis.length} item${vis.length === 1 ? "" : "s"}`, head);
      into = sec;
    }
    if (vis.length === 0) {
      h("div", "empty", "nothing here", into);
      continue;
    }
    if (prefs.view === "heat") {
      const key = (item: Item) => {
        const heat = itemHeat(item, ctx.now, ctx.opts);
        return heat.ageMs !== undefined ? -heat.ageMs : heat.state === "unknown" ? -1e15 : 1e15;
      };
      for (const e of [...vis].sort((a, b) => key(a.item) - key(b.item))) into.appendChild(buildCard(ctx, e.item, e.workstream, true));
      continue;
    }
    // The order of the file, so positions stay familiar. Items without a workstream sit in a plain box at the end.
    for (const ws of workstreams(doc)) {
      const mine = vis.filter((e) => e.workstream === ws);
      if (mine.length > 0) into.appendChild(buildBox(ctx, ws, mine, lane));
    }
    const loose = vis.filter((e) => !e.workstream);
    if (loose.length > 0) into.appendChild(buildBox(ctx, undefined, loose, lane));
  }

  // Workstreams with no items at all sit at the bottom, outside the lanes, until they get one or are deleted.
  const empties = [...workstreams(doc)].filter((ws) => !ws.children.some((c) => c.kind === "item"));
  if (empties.length > 0) {
    const head = h("div", "lanehead", undefined, list);
    h("span", "", "Empty workstreams", head);
    h("span", "n", String(empties.length), head);
    for (const ws of empties) list.appendChild(buildBox(ctx, ws, [], "empty"));
  }
}

function buildBox(ctx: Ctx, ws: Workstream | undefined, entries: Entry[], lane: string): HTMLElement {
  const box = h("div", ws ? "wsgroup" : "wsgroup none");
  box.style.cssText = wsStyle(ctx.host.prefs, ws?.id);
  const head = buildHeader(ctx, ws, entries.length);
  box.appendChild(head);
  if (ws?.id) wsSource(box, head, ws.id, lane);
  dropZone(ctx, box, ws?.id, lane);
  for (const e of entries) box.appendChild(buildCard(ctx, e.item, e.workstream, false));
  return box;
}

function buildHeader(ctx: Ctx, ws: Workstream | undefined, count: number): HTMLElement {
  const head = h("div", "group");
  const wsId = ws?.id ?? "";
  if (ws) {
    const dot = h("button", "dot", undefined, head);
    dot.title = "Change colour";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      colourPopover(ctx, dot, wsId);
    });
    const name = h("span", "wsname editable", ws.name, head);
    name.title = "Click to rename";
    name.addEventListener("click", (e) => {
      e.stopPropagation();
      liveEdit(name, {
        value: ws.name,
        limit: LIMITS.workstream,
        onCommit: (v) => (v ? ctx.actions.do((s) => void rename(s.doc, wsId, v)) : ctx.draw()),
        onEnd: ctx.draw
      });
    });
  } else {
    head.append("Without workstream");
  }
  h("span", "n", ws && count === 0 ? "no items" : String(count), head);
  if (ws) rollupChips(ctx, ws, head);

  const acts = h("span", "acts", undefined, head);
  const add = h("button", "ic", undefined, acts);
  add.title = "Add item";
  add.appendChild(icon("plus"));
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    inputPopover(add, { label: ws ? `New item in ${ws.name}` : "New item", placeholder: "Name", max: LIMITS.name, ok: "Add" }, (name) =>
      ctx.actions.do((s) => void addItem(s.doc, name, ws ? { parentId: wsId } : {}))
    );
  });
  if (ws) {
    const del = h("button", "ic danger", undefined, acts);
    del.title = "Delete workstream";
    del.appendChild(icon("x"));
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteWorkstream(ctx, del, ws);
    });
  }
  return head;
}

/** The workstream's rolled-up lane, shown only when it is not Now. Heat is visible on the items themselves. */
function rollupChips(ctx: Ctx, ws: Workstream, head: HTMLElement): void {
  if (!ws.children.some((c) => c.kind === "item")) return;
  const { lane } = rollup(ws, ctx.now, ctx.opts);
  if (lane !== "now") h("span", "lane", LANE_NAMES[lane], head);
}

function deleteWorkstream(ctx: Ctx, anchor: HTMLElement, ws: Workstream): void {
  const wsId = ws.id ?? "";
  const n = ws.children.filter((c) => c.kind === "item").length;
  confirmPopover(
    anchor,
    {
      text: "Delete",
      name: ws.name,
      suffix: n > 0 ? ` and its ${n} item${n === 1 ? "" : "s"}` : "",
      note: n > 0 ? "Its items are archived with their events at the next sweep, so history is kept." : "It has no items.",
      ok: "Delete"
    },
    () =>
      ctx.actions.do((s) => {
        const target = findWorkstream(s.doc, wsId);
        if (!target) return;
        for (const c of target.children) if (c.kind === "item" && c.id) setLane(s.doc, c.id, "done");
        removeEmptyWorkstream(s.doc, wsId);
      })
  );
}

function colourPopover(ctx: Ctx, anchor: HTMLElement, wsId: string): void {
  const { prefs } = ctx.host;
  popover(anchor, (box) => {
    const row = h("div", "hues", undefined, box);
    const current = wsHue(prefs, wsId);
    for (const hue of HUES) {
      const b = h("button", hue === current ? "hue on" : "hue", undefined, row);
      b.style.background = `hsl(${hue} 55% 55%)`;
      b.title = `Hue ${hue}`;
      b.addEventListener("click", () => {
        prefs.wsHues[wsId] = hue;
        ctx.host.savePrefs();
        closePop();
        ctx.draw();
      });
    }
    const reset = h("button", "", "Default colour", box);
    reset.style.fontSize = "12px";
    reset.style.color = "var(--text-muted)";
    reset.addEventListener("click", () => {
      delete prefs.wsHues[wsId];
      ctx.host.savePrefs();
      closePop();
      ctx.draw();
    });
  });
}

export function renderSummary(ctx: Ctx, el: HTMLElement): void {
  const counts: Record<string, number> = { hot: 0, warm: 0, cold: 0, parked: 0, unknown: 0 };
  for (const { item } of items(ctx.store.doc)) {
    if (item.lane === "done") continue;
    const state = itemHeat(item, ctx.now, ctx.opts).state;
    if (state in counts) counts[state]!++;
  }
  el.replaceChildren();
  for (const k of ["hot", "warm", "cold", "parked", "unknown"]) {
    if (!counts[k]) continue;
    const span = h("span", "", undefined, el);
    h("i", "dot", undefined, span).style.background = `var(--hottasks-${k})`;
    h("b", "", String(counts[k]), span);
    span.append(` ${k === "unknown" ? "no dates" : k}`);
  }
}
