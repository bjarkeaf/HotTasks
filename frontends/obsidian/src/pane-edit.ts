import type { Timestamp } from "@hottasks/core";

/** Character limits from the backend spec, section 9, so a row stays on one line. */
export const LIMITS = { name: 32, status: 14, workstream: 24, task: 80, event: 80 } as const;

const PREFIX = "hottasks-";

/** Creates an element. Every class name gets the hottasks- prefix. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string, parent?: Node): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cx(cls);
  if (text !== undefined) el.textContent = text;
  parent?.appendChild(el);
  return el;
}

export function cx(cls: string): string {
  return cls
    .split(" ")
    .filter((c) => c !== "")
    .map((c) => PREFIX + c)
    .join(" ");
}

const ICONS = {
  plus: ["M8 3v10M3 8h10", 2],
  x: ["M4 4l8 8M12 4l-8 8", 2],
  sort: ["M3 4h10M3 8h7M3 12h4", 1.6],
  filter: ["M2 3h12l-4.5 5.5V13l-3-1.5V8.5z", 1.6]
} as const;

export function icon(name: keyof typeof ICONS, size = 13): SVGElement {
  const [d, width] = ICONS[name];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(k, String(v));
  }
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}


/** What the pane shows: no year unless it differs from this year. The file always keeps the full date. */
export function showTime(ts: Timestamp, now: Date = new Date()): string {
  const full = ts.time === undefined ? ts.date : `${ts.date} ${ts.time}`;
  return ts.date.startsWith(`${now.getFullYear()}-`) ? full.slice(5) : full;
}

export function fullTime(ts: Timestamp): string {
  return ts.time === undefined ? ts.date : `${ts.date} ${ts.time}`;
}

/** Accepts `10:30`, `yesterday 14:00`, `2 h ago`, `10-28 09:15`, `2026-10-28 09:15` and `2026-10-28`. A date alone means the end of that day. */
export function parseWhen(input: string, now: Date = new Date()): Date | null {
  const s = input.trim().toLowerCase();
  const d = new Date(now);
  if (s === "" || s === "now") return d;
  let m = /^(\d+)\s*(min|h|d)\s*ago$/.exec(s);
  if (m) {
    const unit = m[2] === "min" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() - Number(m[1]) * unit);
  }
  m = /^(yesterday|today)?\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    if (m[1] === "yesterday") d.setDate(d.getDate() - 1);
    d.setHours(Number(m[2]), Number(m[3]), 0, 0);
    return d;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 23, m[5] ? Number(m[5]) : 59);
  m = /^(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) return new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), m[3] ? Number(m[3]) : 23, m[4] ? Number(m[4]) : 59);
  return null;
}

// Live editing: the text is edited where it sits, so everything around it moves with it. Enter or click-away saves, Escape cancels.
let editing = false;
let activeFinish: ((save: boolean) => void) | null = null;
let swallowClick = false;

export const isEditing = () => editing;

// While the list is rebuilt the browser may blur the focused field. That must not count as the user leaving it.
let rendering = false;
export const isRendering = () => rendering;
export const setRendering = (on: boolean) => {
  rendering = on;
};

export interface LiveOptions {
  value: string;
  limit?: number;
  placeholder?: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
  /** Called when the edit ends without a change, so the caller can redraw. */
  onEnd: () => void;
}

function selectAll(el: HTMLElement, collapse = false): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  if (collapse) range.collapse(false);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function liveEdit(el: HTMLElement, o: LiveOptions): void {
  if (editing) return;
  editing = true;
  const original = o.value;
  // Text that came in longer than the limit (hand-edited in the file) is never cut, it just cannot grow.
  let limit = o.limit;
  if (limit && original.length > limit) limit = original.length;
  el.classList.add(cx("live"));
  el.classList.remove(cx("empty"), cx("addstatus"));
  el.style.color = "var(--text-normal)";
  el.style.fontStyle = "normal";
  el.textContent = original;
  if (o.placeholder) el.dataset.placeholder = o.placeholder;
  el.contentEditable = "plaintext-only";
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  el.focus();
  // A one-line field is usually retyped, so it is selected. A block of text is usually extended, so the caret goes to the end.
  selectAll(el, o.multiline);
  let done = false;
  let explicit = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    editing = false;
    activeFinish = null;
    el.contentEditable = "false";
    el.classList.remove(cx("live"));
    let v = o.multiline
      ? el.innerText.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim()
      : (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (o.multiline && v === "" && (el.textContent ?? "").trim() !== "") v = (el.textContent ?? "").trim();
    // A block of text is never emptied by a click-away. Clearing it takes Ctrl+Enter on the empty field.
    if (save && o.multiline && v === "" && original !== "" && !explicit) {
      console.warn("HotTasks: refused to save an empty block", { connected: el.isConnected, text: el.textContent });
      save = false;
    }
    if (save && v !== original) o.onCommit(v);
    else o.onEnd();
  };
  el.addEventListener("input", () => {
    if (limit && (el.textContent ?? "").length > limit) {
      el.textContent = (el.textContent ?? "").slice(0, limit);
      selectAll(el, true);
    }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (!o.multiline || e.ctrlKey)) {
      e.preventDefault();
      explicit = true;
      finish(true);
    }
    if (e.key === "Escape") finish(false);
    e.stopPropagation();
  });
  el.addEventListener("blur", () => finish(true));
  el.addEventListener("click", (e) => e.stopPropagation());
  activeFinish = finish;
}

/** Registered on the document in the capture phase. A click elsewhere saves the edit first, then lands on what was clicked. */
export function onOutsideMouseDown(e: MouseEvent): void {
  if (!activeFinish || e.composedPath().some((n) => n instanceof HTMLElement && n.classList.contains(cx("live")))) return;
  const { clientX, clientY } = e;
  activeFinish(true);
  e.preventDefault();
  swallowClick = true;
  setTimeout(() => {
    swallowClick = false;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX, clientY }));
    if (target instanceof HTMLElement && target.matches("input, [contenteditable]")) target.focus();
  }, 0);
}

export function onSwallowedClick(e: MouseEvent): void {
  if (!swallowClick) return;
  e.stopImmediatePropagation();
  e.preventDefault();
}

// Popovers and menus hang off document.body so no pane layout clips them.
let pop: HTMLElement | null = null;
let menu: HTMLElement | null = null;

export function closePop(): void {
  pop?.remove();
  pop = null;
}

export function closeMenu(): void {
  menu?.remove();
  menu = null;
}

export function closeFloating(): void {
  closePop();
  closeMenu();
}

/** A click or Escape outside closes whatever is open. */
export function onFloatingDismiss(e: Event): void {
  if (e instanceof KeyboardEvent) {
    if (e.key === "Escape") closeFloating();
    return;
  }
  const path = e.composedPath();
  if (pop && !path.includes(pop)) closePop();
  if (menu && !path.includes(menu)) closeMenu();
}

/** Right-aligned under the anchor, so the confirm button on the right sits under the cursor. */
export function popover(anchor: HTMLElement, build: (box: HTMLElement) => void): HTMLElement {
  closeFloating();
  const box = h("div", "pop", undefined, document.body);
  pop = box;
  build(box);
  const r = anchor.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
  box.style.top = `${Math.min(r.bottom + 4, innerHeight - box.offsetHeight - 8)}px`;
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePop();
  });
  box.querySelector("input")?.focus();
  return box;
}

export function popButtons(box: HTMLElement, ok: string, kind: "primary" | "danger", onOk: () => void): void {
  const row = h("div", "btns", undefined, box);
  h("button", "", "Cancel", row).addEventListener("click", closePop);
  h("button", kind, ok, row).addEventListener("click", () => {
    closePop();
    onOk();
  });
}

export function inputPopover(anchor: HTMLElement, o: { label: string; placeholder: string; max: number; ok: string }, onOk: (value: string) => void): void {
  popover(anchor, (box) => {
    const label = h("label", "", o.label, box);
    const input = h("input", "", undefined, label);
    input.placeholder = o.placeholder;
    input.maxLength = o.max;
    const submit = () => {
      const v = input.value.trim();
      if (v) onOk(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      closePop();
      submit();
    });
    popButtons(box, o.ok, "primary", submit);
  });
}

export function confirmPopover(anchor: HTMLElement, o: { text: string; name: string; suffix?: string; note: string; ok: string }, onOk: () => void): void {
  popover(anchor, (box) => {
    const p = h("p", "", `${o.text} `, box);
    h("b", "", o.name, p);
    p.append(`${o.suffix ?? ""}?`);
    const note = h("p", "", o.note, box);
    note.style.color = "var(--text-muted)";
    note.style.fontSize = "12px";
    popButtons(box, o.ok, "danger", onOk);
  });
}

export function menuItem(parent: HTMLElement, text: string, on: boolean, onClick: () => void): HTMLButtonElement {
  const b = h("button", on ? "on" : "", text, parent);
  b.addEventListener("click", onClick);
  return b;
}

export function menuHeading(parent: HTMLElement, text: string): void {
  h("div", "h", text, parent);
}

/** Menu at a point, used by the right-click menu. */
export function menuAt(x: number, y: number, build: (menu: HTMLElement) => void): void {
  closeFloating();
  const m = h("div", "menu", undefined, document.body);
  menu = m;
  build(m);
  m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
}

/** Menu under a toolbar button. It stays open while options are clicked, `build` runs again after each pick. */
export function dropdown(anchor: HTMLElement, build: (menu: HTMLElement, rebuild: () => void) => void): void {
  closeFloating();
  const m = h("div", "menu", undefined, document.body);
  menu = m;
  const rebuild = () => {
    m.replaceChildren();
    build(m, rebuild);
  };
  rebuild();
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${r.bottom + 4}px`;
}
