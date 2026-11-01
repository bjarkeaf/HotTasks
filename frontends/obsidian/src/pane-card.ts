import { MarkdownRenderer, Notice } from "obsidian";
import type { Component } from "obsidian";
import type { Event, HeatOptions, Item, Store, Workstream } from "@hottasks/core";
import { findItem, addEvent, addTask, completeTask, editTask, formatAge, itemHeat, removeTask, reopenTask, setInfo, setLane, setStatus, timestampFromDate, timestampToMillis, touch } from "@hottasks/core";
import type { Heat } from "@hottasks/core";
import type { Actions } from "./pane-actions";
import { editEvent, removeEvent } from "./pane-actions";
import { LIMITS, confirmPopover, cx, fullTime, h, icon, isRendering, liveEdit, parseWhen, showTime } from "./pane-edit";
import type { PaneHost } from "./pane-state";
import { wsStyle } from "./pane-state";

/** What every builder needs. `draw` redraws the whole list. */
export interface Ctx {
  store: Store;
  host: PaneHost;
  actions: Actions;
  now: Date;
  opts: HeatOptions;
  allEvents: Set<string>;
  /** Owner of rendered Markdown, so links and embeds are cleaned up with the view. */
  component: Component;
  draw(): void;
  toggle(id: string): void;
}

const DONE = "Done: ";

let refocus: string | null = null;

/** After adding a task with Enter the new-task field of that item gets the focus back. */
export function takeRefocus(): string | null {
  const id = refocus;
  refocus = null;
  return id;
}
const SYSTEM_EVENT = /^(Touched|Done|Archived|Lane: .+|Status: .+)$/;

/** The doc may have been replaced by a sweep or reload since the row was drawn, so look the item up again. */
function withItem(store: Store, id: string, fn: (item: Item) => void): void {
  const found = findItem(store.doc, id);
  if (found) fn(found.item);
}

function stamp(ev: Event): number {
  return ev.at ? timestampToMillis(ev.at) : -Infinity;
}

/** Events with their index in the file, oldest first by time. */
export function byTime(item: Item): Array<{ ev: Event; i: number }> {
  return item.events.map((ev, i) => ({ ev, i })).sort((a, b) => stamp(a.ev) - stamp(b.ev) || a.i - b.i);
}

function doneToday(item: Item, now: Date): Array<{ ev: Event; i: number }> {
  const today = timestampFromDate(now, false).date;
  return item.events.map((ev, i) => ({ ev, i })).filter(({ ev }) => ev.text.startsWith(DONE) && ev.at?.date === today);
}

function ageLabel(heat: Heat): string {
  if (heat.state === "unknown") return "no dates";
  if (heat.state === "parked") return "parked";
  if (heat.state === "terminal" || heat.ageMs === undefined) return "";
  return formatAge(heat.ageMs);
}

export function heatTitle(heat: Heat, last: string): string {
  if (heat.state === "parked" && heat.parkedUntil) return `Parked until ${heat.parkedUntil.date}. Click to touch.`;
  return `Touch: reset the clock to now. Last: ${last}`;
}

export function buildCard(ctx: Ctx, item: Item, ws: Workstream | undefined, showWs: boolean): HTMLElement {
  const id = item.id ?? "";
  const heat = itemHeat(item, ctx.now, ctx.opts);
  const open = ctx.host.prefs.open === id && id !== "";
  const card = h("div", `card ${item.lane}${open ? " open" : ""}`);
  card.style.cssText = `${wsStyle(ctx.host.prefs, ws?.id)}--hottasks-c: var(--hottasks-${heat.state});`;
  card.dataset.id = id;

  const row = h("div", "row", undefined, card);
  row.tabIndex = 0;
  row.setAttribute("aria-expanded", String(open));
  h("span", "bar", undefined, row);
  const main = h("div", "main", undefined, row);
  if (showWs && ws) h("span", "wstag", ws.name, main);
  buildName(ctx, item, main, open);
  if (open) buildOpenTasks(ctx, item, main);
  else buildClosedTasks(ctx, item, main);

  const age = h("div", "age", undefined, row);
  const acts = h("span", "acts", undefined, age);
  const del = h("button", "ic danger", undefined, acts);
  del.title = "Delete item";
  del.appendChild(icon("x"));
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    confirmPopover(del, { text: "Delete", name: item.name, note: "It is archived with its events at the next sweep, so history is kept.", ok: "Delete" }, () =>
      ctx.actions.do((s) => setLane(s.doc, id, "done"))
    );
  });
  const block = h("button", `block ${heat.state}`, ageLabel(heat), age);
  block.title = heatTitle(heat, newest(item)?.text ?? "");
  block.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.actions.do((s) => void touch(s.doc, id));
  });

  if (open) card.appendChild(buildDetail(ctx, item));

  card.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(`.${cx("detail")}`) || t.closest(`input, .${cx("live")}`) || t.closest(`.${cx("tasks")}:not(.${cx("closed")}) .${cx("tk")}`)) return;
    ctx.toggle(id);
  });
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target === row) ctx.toggle(id);
  });
  row.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(`input, button, .${cx("live")}, .${cx("editable")}`)) return;
    ctx.actions.do((s) => void touch(s.doc, id));
  });
  return card;
}

function newest(item: Item): Event | undefined {
  const all = byTime(item);
  return all[all.length - 1]?.ev;
}

function buildName(ctx: Ctx, item: Item, main: HTMLElement, open: boolean): void {
  const id = item.id ?? "";
  const status = item.status ?? "";
  const over = item.name.length > LIMITS.name || status.length > LIMITS.status;
  const name = h("div", over ? "name over" : "name", undefined, main);
  const t = h("span", "t editable", item.name, name);
  t.title = item.name.length > LIMITS.name ? `Longer than ${LIMITS.name} characters, shorten it to keep the row on one line` : "Click to rename";
  t.addEventListener("click", (e) => {
    e.stopPropagation();
    liveEdit(t, {
      value: item.name,
      limit: LIMITS.name,
      placeholder: "name",
      onCommit: (v) => (v ? ctx.actions.do((s) => s.rename(id, v)) : ctx.draw()),
      onEnd: ctx.draw
    });
  });
  const s = h("span", status ? "status editable" : `status addstatus editable${open ? "" : " onhover"}`, status || "status", name);
  s.dataset.edit = "status";
  s.title = status ? "Click to change status" : "Set a status";
  s.addEventListener("click", (e) => {
    e.stopPropagation();
    liveEdit(s, {
      value: status,
      limit: LIMITS.status,
      placeholder: "status",
      onCommit: (v) => ctx.actions.do((st) => setStatus(st.doc, id, v === "" ? undefined : v)),
      onEnd: ctx.draw
    });
  });
  if (item.lane === "later") h("span", "lane", "Later", name);
}

function checkbox(parent: HTMLElement, checked: boolean, title: string, onClick: () => void): HTMLInputElement {
  const box = h("input", "", undefined, parent);
  box.type = "checkbox";
  box.checked = checked;
  box.title = title;
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return box;
}

function taskText(ctx: Ctx, item: Item, i: number, parent: HTMLElement): HTMLElement {
  const id = item.id ?? "";
  const task = item.tasks[i]!;
  const span = h("span", "editable", task.text, parent);
  span.title = "Click to edit";
  span.addEventListener("click", (e) => {
    e.stopPropagation();
    liveEdit(span, {
      value: task.text,
      limit: LIMITS.task,
      onCommit: (v) => ctx.actions.do((s) => void editTask(s.doc, id, i, v, task.notBefore)),
      onEnd: ctx.draw
    });
  });
  if (task.notBefore) h("span", "more", ` (${task.notBefore.date})`, parent);
  return span;
}

function doneRow(ctx: Ctx, item: Item, ev: Event, i: number, cls: string, parent: HTMLElement): void {
  const row = h("div", cls, undefined, parent);
  checkbox(row, true, "Untick to reopen this task", () => ctx.actions.do((s) => void reopenTask(s.doc, item.id ?? "", i)));
  h("span", "", ev.text.slice(DONE.length), row);
}

function buildClosedTasks(ctx: Ctx, item: Item, main: HTMLElement): void {
  const id = item.id ?? "";
  const done = doneToday(item, ctx.now);
  const last = newest(item);
  const lastLine = () => {
    if (!last?.at) return;
    const line = h("div", "last", undefined, main);
    line.title = "Latest event";
    h("time", "", showTime(last.at, ctx.now), line);
    line.append(last.text);
  };
  if (item.tasks.length === 0 && done.length === 0) {
    const none = h("div", "task tk none", undefined, main);
    const box = h("input", "", undefined, none);
    box.type = "checkbox";
    box.disabled = true;
    box.tabIndex = -1;
    const span = h("span", "editable", "no task", none);
    span.title = "Click to add a task";
    span.addEventListener("click", (e) => {
      e.stopPropagation();
      liveEdit(span, {
        value: "",
        limit: LIMITS.task,
        placeholder: "task",
        onCommit: (v) => ctx.actions.do((s) => void addTask(s.doc, id, v)),
        onEnd: ctx.draw
      });
    });
    lastLine();
    return;
  }
  const list = h("div", "tasks closed", undefined, main);
  item.tasks.forEach((_, i) => {
    const row = h("div", "task tk", undefined, list);
    checkbox(row, false, "Done, logs an event", () => ctx.actions.do((s) => void completeTask(s.doc, id, i)));
    taskText(ctx, item, i, row);
  });
  for (const { ev, i } of done) doneRow(ctx, item, ev, i, "task tk pending", list);
  lastLine();
}

function buildOpenTasks(ctx: Ctx, item: Item, main: HTMLElement): void {
  const id = item.id ?? "";
  const list = h("div", "tasks", undefined, main);
  item.tasks.forEach((_, i) => {
    const row = h("div", "tk", undefined, list);
    checkbox(row, false, "Done, logs an event", () => ctx.actions.do((s) => void completeTask(s.doc, id, i)));
    taskText(ctx, item, i, row);
    const x = h("button", "ic danger tx", undefined, row);
    x.title = "Remove task without logging it";
    x.appendChild(icon("x"));
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      ctx.actions.do((s) => removeTask(s.doc, id, i));
    });
  });
  for (const { ev, i } of doneToday(item, ctx.now)) doneRow(ctx, item, ev, i, "tk pending", list);

  const add = h("div", "tk newtk", undefined, list);
  const done = checkbox(add, false, "Add and mark done at once", () => {
    const v = input.value.trim();
    done.checked = false;
    if (v === "") {
      input.focus();
      new Notice("Write the task first");
      return;
    }
    input.value = "";
    ctx.actions.do((s) => void addEvent(s.doc, id, DONE + v));
  });
  const input = h("input", "newtask", undefined, add);
  input.placeholder = item.tasks.length ? "Another task" : "What is the next step?";
  input.maxLength = LIMITS.task;
  input.setAttribute("aria-label", "New task");
  const commit = () => {
    const v = input.value.trim();
    input.value = "";
    if (v) ctx.actions.do((s) => void addTask(s.doc, id, v));
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (input.value.trim() !== "") refocus = id;
      commit();
    }
    if (e.key === "Escape") {
      input.value = "";
      input.blur();
    }
  });
  input.addEventListener("focusout", (e) => {
    if (e.relatedTarget === done || isRendering()) return;
    commit();
  });
}

function buildDetail(ctx: Ctx, item: Item): HTMLElement {
  const id = item.id ?? "";
  const detail = h("div", "detail");
  h("h4", "", "Info", detail);
  const lines = item.info.map((i) => i.text);
  const info = h("div", lines.length ? "info editable" : "info editable empty", lines.length ? undefined : "Anything worth keeping with this item", detail);
  info.title = "Click to edit, one line per point. Links open on click.";
  // Rendered as Markdown so links work. Each line is its own paragraph, matching one bullet per line in the file.
  if (lines.length) void MarkdownRenderer.render(ctx.host.app, lines.join("\n\n"), info, ctx.store.tasksPath, ctx.component);
  info.addEventListener("click", (e) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest("a")) return;
    info.replaceChildren();
    liveEdit(info, {
      value: lines.join("\n"),
      multiline: true,
      placeholder: "one line per point",
      onCommit: (v) =>
        ctx.actions.do((s) => void setInfo(s.doc, id, v.split("\n").map((l) => l.trim()).filter((l) => l !== ""))),
      onEnd: ctx.draw
    });
  });

  h("h4", "", "Events", detail);
  const add = h("div", "add", undefined, detail);
  const when = h("input", "when", undefined, add);
  when.value = showTime(timestampFromDate(ctx.now), ctx.now);
  when.dataset.input = "when";
  when.title = "Now by default. Type 10:30, yesterday 14:00, 2 h ago, 10-28 09:15 or 2026-10-28 09:15 for something that happened earlier";
  when.setAttribute("aria-label", "When");
  const text = h("input", "", undefined, add);
  text.placeholder = "What happened";
  text.dataset.input = "event";
  text.maxLength = LIMITS.event;
  text.setAttribute("aria-label", "New event");
  const submit = () => {
    const v = text.value.trim();
    if (v === "") return void new Notice("Write what happened first");
    const at = parseWhen(when.value);
    if (!at) return void new Notice("Could not read that time");
    text.value = "";
    ctx.actions.do((s) => void addEvent(s.doc, id, v, timestampFromDate(at)));
  };
  for (const el of [when, text]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  const events = byTime(item);
  if (events.length === 0) {
    const none = h("div", "", "none yet", detail);
    none.style.color = "var(--text-faint)";
    return detail;
  }
  const all = ctx.allEvents.has(id);
  const shown = (all ? events : events.slice(-4)).reverse();
  for (const { ev, i } of shown) buildEventRow(ctx, item, ev, i, detail);
  if (events.length > 4) {
    const more = h("div", "hint", all ? "Show fewer" : `${events.length - 4} older, show all`, detail);
    more.style.cursor = "pointer";
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      if (all) ctx.allEvents.delete(id);
      else ctx.allEvents.add(id);
      ctx.draw();
    });
  }
  return detail;
}

function buildEventRow(ctx: Ctx, item: Item, ev: Event, i: number, parent: HTMLElement): void {
  const id = item.id ?? "";
  const row = h("div", SYSTEM_EVENT.test(ev.text.trim()) ? "ev sys" : "ev", undefined, parent);
  row.title = "Click to edit";
  const time = h("time", "", ev.at ? showTime(ev.at, ctx.now) : "", row);
  if (ev.at) time.title = fullTime(ev.at);
  const span = h("span", "", ev.text, row);
  const x = h("button", "ic danger evx", undefined, row);
  x.title = "Remove this event";
  x.appendChild(icon("x"));
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.actions.do((s) => withItem(s, id, (it) => removeEvent(it, i)));
  });
  time.addEventListener("click", (e) => {
    e.stopPropagation();
    liveEdit(time, {
      value: ev.at ? showTime(ev.at, ctx.now) : "",
      limit: 20,
      onCommit: (v) => {
        const at = parseWhen(v);
        if (!at) {
          new Notice("Could not read that time");
          ctx.draw();
        } else ctx.actions.do((s) => withItem(s, id, (it) => editEvent(it, i, { at: timestampFromDate(at) })));
      },
      onEnd: ctx.draw
    });
  });
  span.addEventListener("click", (e) => {
    e.stopPropagation();
    liveEdit(span, {
      value: ev.text,
      limit: LIMITS.event,
      placeholder: "what happened",
      onCommit: (v) => (v ? ctx.actions.do((s) => withItem(s, id, (it) => editEvent(it, i, { text: v }))) : ctx.draw()),
      onEnd: ctx.draw
    });
  });
}
